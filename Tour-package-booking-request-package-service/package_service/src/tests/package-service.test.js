// Package Service tests: normal, invalid and security cases.
// Runs fully offline: a local DynamoDB emulator (dynalite), a fake Cognito
// key server and a fake exchange-rate API.
//
//   cd package_service/src && npm install && npm test

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const crypto = require("node:crypto");
const path = require("node:path");
const { execFile } = require("node:child_process");
const dynalite = require("dynalite");

const DB_PORT = 45991;
const JWKS_PORT = 45992;
const RATES_PORT = 45993;
const ISSUER = "http://localhost:4566/us-east-1_testpool";
const CLIENT_ID = "test-client";

Object.assign(process.env, {
    NODE_ENV: "test",
    AWS_REGION: "us-east-1",
    AWS_ACCESS_KEY_ID: "test",
    AWS_SECRET_ACCESS_KEY: "test",
    DYNAMODB_ENDPOINT: `http://localhost:${DB_PORT}`,
    DYNAMODB_TABLE: "Packages",
    COGNITO_ISSUER: ISSUER,
    COGNITO_JWKS_URL: `http://localhost:${JWKS_PORT}/.well-known/jwks.json`,
    COGNITO_CLIENT_ID: CLIENT_ID,
    STAFF_GROUP: "staff",
    CORS_ORIGINS: "http://localhost:4566",
    EXCHANGE_API_URL: `http://localhost:${RATES_PORT}/v2`
});

// ---------- fake Cognito tokens ----------
const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "test-key", alg: "RS256", use: "sig" };
const b64 = value => Buffer.from(JSON.stringify(value)).toString("base64url");

function makeToken(extraClaims = {}, signingKey = privateKey) {
    const now = Math.floor(Date.now() / 1000);
    const header = b64({ alg: "RS256", kid: "test-key" });
    const payload = b64({
        iss: ISSUER, aud: CLIENT_ID, token_use: "id", sub: "user-1",
        email: "user@example.com", exp: now + 3600, ...extraClaims
    });
    const signature = crypto.sign("RSA-SHA256", Buffer.from(`${header}.${payload}`), signingKey).toString("base64url");
    return `${header}.${payload}.${signature}`;
}

const STAFF = makeToken({ "cognito:groups": ["staff"] });
const CUSTOMER = makeToken({ "cognito:groups": ["customer"] });

// ---------- fake exchange-rate API ----------
let ratesDown = false;
const ratesServer = http.createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    if (ratesDown) {
        res.statusCode = 503;
        return res.end("{}");
    }
    if (req.url === "/v2/rate/EGP/USD") {
        return res.end(JSON.stringify({ base: "EGP", quote: "USD", rate: 0.0205, date: "2026-11-27" }));
    }
    res.statusCode = 404;
    return res.end(JSON.stringify({ message: "not found" }));
});

const jwksServer = http.createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ keys: [jwk] }));
});

let db;
let server;
let baseUrl;
let createdId;

async function api(method, url, { token, body, rawBody, headers = {} } = {}) {
    const response = await fetch(`${baseUrl}${url}`, {
        method,
        headers: {
            "content-type": "application/json",
            ...(token ? { authorization: `Bearer ${token}` } : {}),
            ...headers
        },
        body: rawBody !== undefined ? rawBody : body !== undefined ? JSON.stringify(body) : undefined
    });
    const text = await response.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: response.status, body: json, text, headers: response.headers };
}

const validPackage = () => ({
    title: "Luxor Temples Tour",
    destination: "Luxor",
    itinerary: ["Karnak Temple", "Valley of the Kings"],
    startDate: "2027-02-01",
    endDate: "2027-02-03",
    price: 900,
    totalSeats: 10
});

before(async () => {
    db = dynalite({ createTableMs: 0 });
    await new Promise(resolve => db.listen(DB_PORT, resolve));
    await new Promise(resolve => jwksServer.listen(JWKS_PORT, resolve));
    await new Promise(resolve => ratesServer.listen(RATES_PORT, resolve));

    const { CreateTableCommand } = require("@aws-sdk/client-dynamodb");
    const dynamodb = require("../config/dynamodb");
    await dynamodb.send(new CreateTableCommand({
        TableName: "Packages",
        AttributeDefinitions: [{ AttributeName: "packageId", AttributeType: "S" }],
        KeySchema: [{ AttributeName: "packageId", KeyType: "HASH" }],
        BillingMode: "PAY_PER_REQUEST"
    }));

    // Insert the 3 sample packages (2 published, 1 draft)
    await new Promise((resolve, reject) => {
        execFile(process.execPath, [path.join(__dirname, "..", "scripts", "seed-packages.js")],
            { env: process.env }, error => (error ? reject(error) : resolve()));
    });

    const app = require("../server");
    server = app.listen(0);
    await new Promise(resolve => server.once("listening", resolve));
    baseUrl = `http://localhost:${server.address().port}`;
});

after(async () => {
    server.close();
    jwksServer.close();
    ratesServer.close();
    await new Promise(resolve => db.close(resolve));
});

// ---------------- Health and general ----------------

test("PS-01 GET /health answers 200 and DynamoDB connected", async () => {
    const r = await api("GET", "/health");
    assert.equal(r.status, 200);
    assert.equal(r.body.database, "DynamoDB Connected");
});

test("PS-02 Unknown route answers 404 JSON (not an HTML page)", async () => {
    const r = await api("GET", "/does-not-exist");
    assert.equal(r.status, 404);
    assert.match(r.body.message, /not found/i);
});

test("PS-03 Malformed JSON answers 400 with a clear message", async () => {
    const r = await api("POST", "/packages", { token: STAFF, rawBody: "{bad json" });
    assert.equal(r.status, 400);
    assert.equal(r.body.message, "Request body must be valid JSON");
});

test("PS-04 Security headers are sent", async () => {
    const r = await api("GET", "/packages");
    assert.equal(r.headers.get("x-content-type-options"), "nosniff");
    assert.equal(r.headers.get("x-frame-options"), "DENY");
    assert.equal(r.headers.get("x-powered-by"), null);
});

test("PS-05 CORS allows the team website and blocks other websites", async () => {
    const allowed = await api("OPTIONS", "/packages", {
        headers: { origin: "http://localhost:4566", "access-control-request-method": "POST" }
    });
    assert.equal(allowed.headers.get("access-control-allow-origin"), "http://localhost:4566");

    const blocked = await api("OPTIONS", "/packages", {
        headers: { origin: "http://evil.example", "access-control-request-method": "POST" }
    });
    assert.equal(blocked.headers.get("access-control-allow-origin"), null);
});

// ---------------- Search and view ----------------

test("PS-06 GET /packages lists only published packages, soonest first", async () => {
    const r = await api("GET", "/packages");
    assert.equal(r.status, 200);
    assert.equal(r.body.length, 2);
    assert.ok(r.body.every(p => p.isPublished === true));
    assert.ok(r.body[0].startDate <= r.body[1].startDate);
});

test("PS-07 Search by part of the destination, any letter case", async () => {
    const r = await api("GET", "/packages?destination=ALEX");
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.map(p => p.destination), ["Alexandria"]);
});

test("PS-08 Search by date range and max price", async () => {
    const r = await api("GET", "/packages?startDate=2026-12-01&endDate=2026-12-31&maxPrice=700");
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.map(p => p.title), ["Giza Pyramids Adventure"]);
});

test("PS-09 Search with no matches answers 200 and an empty list", async () => {
    const r = await api("GET", "/packages?destination=Antarctica");
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, []);
});

test("PS-10 Invalid search filters are rejected with 400", async () => {
    assert.equal((await api("GET", "/packages?maxPrice=abc")).status, 400);
    assert.equal((await api("GET", "/packages?maxPrice=-5")).status, 400);
    assert.equal((await api("GET", "/packages?startDate=hello")).status, 400);
    assert.equal((await api("GET", "/packages?startDate=2027-02-30")).status, 400);
    assert.equal((await api("GET", "/packages?startDate=2027-03-01&endDate=2027-01-01")).status, 400);
});

test("PS-11 GET /packages/:id returns full details with the itinerary", async () => {
    const r = await api("GET", "/packages/11111111-1111-4111-8111-111111111111");
    assert.equal(r.status, 200);
    assert.equal(r.body.title, "Giza Pyramids Adventure");
    assert.ok(Array.isArray(r.body.itinerary) && r.body.itinerary.length > 0);
});

test("PS-12 GET /packages/:id for a package that does not exist answers 404", async () => {
    const r = await api("GET", "/packages/no-such-package");
    assert.equal(r.status, 404);
});

// ---------------- Staff login and roles ----------------

test("PS-13 Drafts list needs a staff login (401 / 403 / 200)", async () => {
    assert.equal((await api("GET", "/packages?isPublished=false")).status, 401);
    assert.equal((await api("GET", "/packages?isPublished=false", { token: CUSTOMER })).status, 403);
    const r = await api("GET", "/packages?isPublished=false", { token: STAFF });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.map(p => p.title), ["Cairo City Adventure"]);
});

test("PS-14 Create without login 401, as customer 403", async () => {
    assert.equal((await api("POST", "/packages", { body: validPackage() })).status, 401);
    assert.equal((await api("POST", "/packages", { token: CUSTOMER, body: validPackage() })).status, 403);
});

test("PS-15 Expired, forged and wrong-client tokens are rejected with 401", async () => {
    const expired = makeToken({ "cognito:groups": ["staff"], exp: Math.floor(Date.now() / 1000) - 60 });
    const otherKey = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
    const forged = makeToken({ "cognito:groups": ["staff"] }, otherKey);
    const wrongClient = makeToken({ "cognito:groups": ["staff"], aud: "another-app" });

    for (const token of [expired, forged, wrongClient, "not-a-token"]) {
        assert.equal((await api("POST", "/packages", { token, body: validPackage() })).status, 401);
    }
});

// ---------------- Create ----------------

test("PS-16 Staff creates a package: 201, saved as a draft, seatsLeft = totalSeats", async () => {
    const r = await api("POST", "/packages", { token: STAFF, body: validPackage() });
    assert.equal(r.status, 201);
    assert.equal(r.body.isPublished, false);
    assert.equal(r.body.seatsLeft, 10);
    createdId = r.body.packageID;

    const publicList = await api("GET", "/packages");
    assert.ok(!publicList.body.some(p => p.packageID === createdId), "draft must not be public");
});

test("PS-17 Create with missing fields answers 400 and names them", async () => {
    const r = await api("POST", "/packages", { token: STAFF, body: { title: "Only a title" } });
    assert.equal(r.status, 400);
    assert.match(r.body.message, /destination/);
});

test("PS-18 Create with invalid values answers 400", async () => {
    const cases = [
        { price: -1 },
        { price: "abc" },
        { totalSeats: 0 },
        { totalSeats: 2.5 },
        { startDate: "2027-13-45" },
        { startDate: "2027-02-10", endDate: "2027-02-01" },
        { itinerary: [] },
        { itinerary: "not a list" },
        { title: "<script>alert(1)</script>" },
        { title: "x".repeat(101) }
    ];
    for (const change of cases) {
        const r = await api("POST", "/packages", { token: STAFF, body: { ...validPackage(), ...change } });
        assert.equal(r.status, 400, `expected 400 for ${JSON.stringify(change)}`);
    }
});

// ---------------- Edit, publish, hide ----------------

test("PS-19 Staff publishes the package; it becomes public", async () => {
    const r = await api("PUT", `/packages/${createdId}`, { token: STAFF, body: { isPublished: true } });
    assert.equal(r.status, 200);
    assert.equal(r.body.isPublished, true);
    const list = await api("GET", "/packages?destination=luxor");
    assert.equal(list.body.length, 1);
});

test("PS-20 Staff edits title and price", async () => {
    const r = await api("PUT", `/packages/${createdId}`, {
        token: STAFF, body: { title: "Luxor and Aswan Tour", price: 1100 }
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.title, "Luxor and Aswan Tour");
    assert.equal(r.body.price, 1100);
});

test("PS-21 Edit validation: bad values, seatsLeft and date order", async () => {
    const bad = [
        { price: -10 },
        { seatsLeft: 999 },
        { endDate: "2027-01-01" }, // before the saved start date 2027-02-01
        { isPublished: "maybe" },
        { unknownField: 1 }
    ];
    for (const body of bad) {
        const r = await api("PUT", `/packages/${createdId}`, { token: STAFF, body });
        assert.equal(r.status, 400, `expected 400 for ${JSON.stringify(body)}`);
    }
});

test("PS-22 Edit without login 401; edit a missing package 404", async () => {
    assert.equal((await api("PUT", `/packages/${createdId}`, { body: { price: 1 } })).status, 401);
    assert.equal((await api("PUT", "/packages/no-such-package", { token: STAFF, body: { price: 1 } })).status, 404);
});

test("PS-23 Staff hides a package; it disappears from the public list", async () => {
    const r = await api("PUT", `/packages/${createdId}`, { token: STAFF, body: { isPublished: false } });
    assert.equal(r.status, 200);
    const list = await api("GET", "/packages?destination=luxor");
    assert.deepEqual(list.body, []);
    await api("PUT", `/packages/${createdId}`, { token: STAFF, body: { isPublished: true } });
});

// ---------------- Seats (business rules) ----------------

test("PS-24 Reserve seats lowers seatsLeft", async () => {
    const r = await api("PATCH", `/packages/${createdId}/reserve`, { body: { travelers: 4 } });
    assert.equal(r.status, 200);
    assert.equal(r.body.package.seatsLeft, 6);
});

test("PS-25 Reserving more seats than are left answers 409", async () => {
    const r = await api("PATCH", `/packages/${createdId}/reserve`, { body: { travelers: 7 } });
    assert.equal(r.status, 409);
});

test("PS-26 Invalid travelers answers 400; unknown package 404", async () => {
    for (const travelers of [0, -2, 1.5, "abc", undefined]) {
        const r = await api("PATCH", `/packages/${createdId}/reserve`, { body: { travelers } });
        assert.equal(r.status, 400);
    }
    assert.equal((await api("PATCH", "/packages/no-such-package/reserve", { body: { travelers: 1 } })).status, 404);
});

test("PS-27 Changing capacity keeps booked seats; cannot go below booked", async () => {
    const up = await api("PUT", `/packages/${createdId}`, { token: STAFF, body: { totalSeats: 12 } });
    assert.equal(up.status, 200);
    assert.equal(up.body.seatsLeft, 8); // 4 booked
    const tooLow = await api("PUT", `/packages/${createdId}`, { token: STAFF, body: { totalSeats: 3 } });
    assert.equal(tooLow.status, 400);
});

test("PS-28 Release seats gives them back; cannot exceed capacity (409)", async () => {
    const r = await api("PATCH", `/packages/${createdId}/release`, { body: { travelers: 4 } });
    assert.equal(r.status, 200);
    assert.equal(r.body.package.seatsLeft, 12);
    const tooMany = await api("PATCH", `/packages/${createdId}/release`, { body: { travelers: 1 } });
    assert.equal(tooMany.status, 409);
});

test("PS-29 The old PATCH /seats endpoint no longer exists (404)", async () => {
    const r = await api("PATCH", `/packages/${createdId}/seats`, { body: { seatsLeft: 999 } });
    assert.equal(r.status, 404);
});

// ---------------- External API: currency conversion ----------------

test("PS-30 Convert price to USD using the exchange-rate API", async () => {
    const r = await api("GET", "/packages/11111111-1111-4111-8111-111111111111/convert?currency=usd");
    assert.equal(r.status, 200);
    assert.equal(r.body.targetCurrency, "USD");
    assert.equal(r.body.convertedAmount, Number((600 * 0.0205).toFixed(2)));
    assert.equal(r.body.rateDate, "2026-11-27");
});

test("PS-31 Convert: missing or invalid currency 400, unknown package 404", async () => {
    const id = "11111111-1111-4111-8111-111111111111";
    assert.equal((await api("GET", `/packages/${id}/convert`)).status, 400);
    assert.equal((await api("GET", `/packages/${id}/convert?currency=DOLLARS`)).status, 400);
    assert.equal((await api("GET", `/packages/${id}/convert?currency=XYZ`)).status, 400);
    assert.equal((await api("GET", "/packages/no-such-package/convert?currency=USD")).status, 404);
});

test("PS-32 Convert when the exchange-rate API is down answers 502", async () => {
    require("../services/currencyService")._clearCache();
    ratesDown = true;
    try {
        const r = await api("GET", "/packages/11111111-1111-4111-8111-111111111111/convert?currency=USD");
        assert.equal(r.status, 502);
    } finally {
        ratesDown = false;
    }
});

// ---------------- Lambda entry point ----------------

test("PS-33 Lambda handler (API Gateway event) returns the package list", async () => {
    const { handler } = require("../lambda");
    const result = await handler({
        httpMethod: "GET",
        path: "/packages",
        headers: {},
        queryStringParameters: { destination: "giza" },
        requestContext: {},
        body: null,
        isBase64Encoded: false
    }, {});
    assert.equal(result.statusCode, 200);
    assert.equal(JSON.parse(result.body)[0].destination, "Giza");
});
