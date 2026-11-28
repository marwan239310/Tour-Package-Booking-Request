// Automated tests for the booking request service (run with: npm test)
// DynamoDB and the package service are replaced by small in-memory fakes,
// so the tests run without Floci and check the business rules and status codes.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert");
const path = require("path");
const http = require("http");

// ---------- Fake DynamoDB ----------
const tables = { BookingRequests: new Map(), StatusHistory: [] };
function conditionFails(input, item) {
  const c = input.ConditionExpression;
  if (!c) return false;
  if (c.startsWith("attribute_not_exists")) return Boolean(item);
  const v = input.ExpressionAttributeValues || {};
  const expected = v[":oldStatus"] !== undefined ? v[":oldStatus"] : v[":pending"];
  return !item || item.status !== expected;
}
const fakeDynamo = {
  async send(command) {
    const name = command.constructor.name;
    const input = command.input;
    if (input.TableName === "StatusHistory") {
      if (name === "PutCommand") { tables.StatusHistory.push(input.Item); return {}; }
      if (name === "QueryCommand") {
        const id = input.ExpressionAttributeValues[":id"];
        return { Items: tables.StatusHistory.filter((h) => h.requestID === id) };
      }
    }
    const t = tables.BookingRequests;
    if (name === "PutCommand") {
      if (conditionFails(input, t.get(input.Item.requestID))) throw Object.assign(new Error("cond"), { name: "ConditionalCheckFailedException" });
      t.set(input.Item.requestID, { ...input.Item }); return {};
    }
    if (name === "GetCommand") return { Item: t.get(input.Key.requestID) };
    if (name === "ScanCommand") {
      const v = input.ExpressionAttributeValues;
      return { Items: [...t.values()].filter((i) => i.customerEmail === v[":email"] && (!v[":status"] || i.status === v[":status"])) };
    }
    if (name === "UpdateCommand") {
      const item = t.get(input.Key.requestID);
      if (conditionFails(input, item)) throw Object.assign(new Error("cond"), { name: "ConditionalCheckFailedException" });
      const v = input.ExpressionAttributeValues;
      if (v[":cancelled"]) item.status = "cancelled";
      if (v[":travelers"] !== undefined) { item.travelers = v[":travelers"]; item.totalPrice = v[":total"]; }
      return { Attributes: { ...item } };
    }
    throw new Error("Unexpected command " + name);
  }
};
require.cache[path.join(__dirname, "../src/config/dynamodb.js")] = {
  id: "fake", filename: "fake", loaded: true, exports: fakeDynamo
};

// ---------- Fake package service ----------
// Works like the package service's /reserve and /release endpoints (same checks, same status codes)
const packages = {};
let releaseBroken = false; // true = /release answers 500 (to test a cancel when the package service fails)
const realFetch = global.fetch;
global.fetch = async (url, options = {}) => {
  const u = String(url);
  if (!u.startsWith("http://package.test")) return realFetch(url, options);
  const match = u.match(/\/packages\/([^/]+)(?:\/(reserve|release))?$/);
  const pkg = packages[decodeURIComponent(match[1])];
  const action = match[2];
  if (!pkg) return new Response(JSON.stringify({ message: "Package not found" }), { status: 404 });
  if (action) {
    const travelers = JSON.parse(options.body).travelers;
    if (!Number.isInteger(travelers) || travelers <= 0) return new Response("{}", { status: 400 });
    if (action === "release" && releaseBroken) return new Response("{}", { status: 500 });
    if (action === "reserve") {
      if (pkg.seatsLeft < travelers) return new Response(JSON.stringify({ message: "Not enough seats available" }), { status: 409 });
      pkg.seatsLeft -= travelers;
    } else {
      if (pkg.seatsLeft + travelers > pkg.totalSeats) return new Response("{}", { status: 409 });
      pkg.seatsLeft += travelers;
    }
    return new Response(JSON.stringify({ message: "ok", package: pkg }), { status: 200 });
  }
  return new Response(JSON.stringify(pkg), { status: 200 });
};
process.env.PACKAGE_SERVICE_URL = "http://package.test";
delete process.env.SNS_TOPIC_ARN; // no SNS in tests

// ---------- Start the app ----------
const app = require("../src/app");
let base;
const server = http.createServer(app).listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; });
const ready = new Promise((r) => server.on("listening", r));
async function call(method, url, body) {
  await ready;
  const res = await realFetch(base + url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined
  });
  return { status: res.status, body: await res.json() };
}
const EMAIL = "karim@example.com";
const valid = (extra = {}) => ({ packageID: "PKG-1", customerName: "Karim Test", customerEmail: EMAIL, phone: "01012345678", travelers: 2, ...extra });

beforeEach(() => {
  releaseBroken = false;
  tables.BookingRequests.clear();
  tables.StatusHistory.length = 0;
  packages["PKG-1"] = { packageID: "PKG-1", title: "Luxor trip", price: 5000, totalSeats: 5, seatsLeft: 5, isPublished: true };
  packages["PKG-HIDDEN"] = { packageID: "PKG-HIDDEN", title: "Hidden", price: 100, totalSeats: 5, seatsLeft: 5, isPublished: false };
});

// ---------- Tests ----------
test("BK-01 submit a valid request -> 201, pending, seats reserved, history saved", async () => {
  const r = await call("POST", "/bookings", valid());
  assert.strictEqual(r.status, 201);
  assert.strictEqual(r.body.status, "pending");
  assert.match(r.body.requestID, /^REQ-/);
  assert.strictEqual(r.body.totalPrice, 10000);
  assert.strictEqual(packages["PKG-1"].seatsLeft, 3);
  assert.strictEqual(tables.StatusHistory.length, 1);
});

test("BK-02 missing fields / bad email / bad phone / bad travelers -> 400", async () => {
  assert.strictEqual((await call("POST", "/bookings", {})).status, 400);
  assert.strictEqual((await call("POST", "/bookings", valid({ customerEmail: "not-an-email" }))).status, 400);
  assert.strictEqual((await call("POST", "/bookings", valid({ phone: "12" }))).status, 400);
  assert.strictEqual((await call("POST", "/bookings", valid({ travelers: 0 }))).status, 400);
  assert.strictEqual((await call("POST", "/bookings", valid({ travelers: 2.5 }))).status, 400);
  assert.strictEqual((await call("POST", "/bookings", valid({ travelers: 11 }))).status, 400);
});

test("BK-03 package that does not exist -> 404", async () => {
  assert.strictEqual((await call("POST", "/bookings", valid({ packageID: "NOPE" }))).status, 404);
});

test("BK-04 hidden package -> 409", async () => {
  assert.strictEqual((await call("POST", "/bookings", valid({ packageID: "PKG-HIDDEN" }))).status, 409);
});

test("BK-05 more travelers than free seats -> 409 and no seats taken", async () => {
  const r = await call("POST", "/bookings", valid({ travelers: 6 }));
  assert.strictEqual(r.status, 409);
  assert.strictEqual(packages["PKG-1"].seatsLeft, 5);
});

test("BK-06 two requests cannot overbook the same package", async () => {
  assert.strictEqual((await call("POST", "/bookings", valid({ travelers: 4 }))).status, 201);
  assert.strictEqual((await call("POST", "/bookings", valid({ travelers: 2 }))).status, 409);
  assert.strictEqual(packages["PKG-1"].seatsLeft, 1);
});

test("BK-07 view my requests needs an email and only returns my requests", async () => {
  await call("POST", "/bookings", valid());
  await call("POST", "/bookings", valid({ customerEmail: "other@example.com", travelers: 1 }));
  assert.strictEqual((await call("GET", "/bookings")).status, 400);
  const mine = await call("GET", `/bookings?email=${EMAIL}`);
  assert.strictEqual(mine.status, 200);
  assert.strictEqual(mine.body.length, 1);
  assert.strictEqual(mine.body[0].customerEmail, EMAIL);
});

test("BK-08 view one request with history; other emails get 404", async () => {
  const created = (await call("POST", "/bookings", valid())).body;
  const r = await call("GET", `/bookings/${created.requestID}?email=${EMAIL}`);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.history.length, 1);
  assert.strictEqual((await call("GET", `/bookings/${created.requestID}?email=other@example.com`)).status, 404);
});

test("BK-09 cancel a pending request -> cancelled and seats returned", async () => {
  const created = (await call("POST", "/bookings", valid())).body;
  const r = await call("PATCH", `/bookings/${created.requestID}/cancel`, { email: EMAIL });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.status, "cancelled");
  assert.strictEqual(packages["PKG-1"].seatsLeft, 5);
  assert.strictEqual(tables.StatusHistory.length, 2);
});

test("BK-10 cancel twice / cancel a rejected request -> 409", async () => {
  const created = (await call("POST", "/bookings", valid())).body;
  await call("PATCH", `/bookings/${created.requestID}/cancel`, { email: EMAIL });
  assert.strictEqual((await call("PATCH", `/bookings/${created.requestID}/cancel`, { email: EMAIL })).status, 409);
  const second = (await call("POST", "/bookings", valid({ travelers: 1 }))).body;
  tables.BookingRequests.get(second.requestID).status = "rejected";
  assert.strictEqual((await call("PATCH", `/bookings/${second.requestID}/cancel`, { email: EMAIL })).status, 409);
});

test("BK-11 someone else cannot cancel my request -> 404", async () => {
  const created = (await call("POST", "/bookings", valid())).body;
  assert.strictEqual((await call("PATCH", `/bookings/${created.requestID}/cancel`, { email: "other@example.com" })).status, 404);
  assert.strictEqual((await call("PATCH", "/bookings/REQ-NOPE/cancel", { email: EMAIL })).status, 404);
});

test("BK-12 change travelers while pending updates seats and price", async () => {
  const created = (await call("POST", "/bookings", valid())).body;
  const up = await call("PATCH", `/bookings/${created.requestID}/travelers`, { email: EMAIL, travelers: 4 });
  assert.strictEqual(up.status, 200);
  assert.strictEqual(up.body.travelers, 4);
  assert.strictEqual(up.body.totalPrice, 20000);
  assert.strictEqual(packages["PKG-1"].seatsLeft, 1);
  const down = await call("PATCH", `/bookings/${created.requestID}/travelers`, { email: EMAIL, travelers: 1 });
  assert.strictEqual(down.status, 200);
  assert.strictEqual(packages["PKG-1"].seatsLeft, 4);
});

test("BK-13 change travelers: not enough seats or not pending -> 409", async () => {
  const created = (await call("POST", "/bookings", valid())).body;
  assert.strictEqual((await call("PATCH", `/bookings/${created.requestID}/travelers`, { email: EMAIL, travelers: 8 })).status, 409);
  await call("POST", "/bookings", valid({ travelers: 3 }));
  assert.strictEqual((await call("PATCH", `/bookings/${created.requestID}/travelers`, { email: EMAIL, travelers: 3 })).status, 409);
  tables.BookingRequests.get(created.requestID).status = "under_review";
  assert.strictEqual((await call("PATCH", `/bookings/${created.requestID}/travelers`, { email: EMAIL, travelers: 1 })).status, 409);
});

test("BK-14 package service down -> 503", async () => {
  process.env.PACKAGE_SERVICE_URL = "http://127.0.0.1:1";
  const r = await call("POST", "/bookings", valid());
  process.env.PACKAGE_SERVICE_URL = "http://package.test";
  assert.strictEqual(r.status, 503);
});

test("BK-15 broken JSON body -> 400; unknown route -> 404", async () => {
  await ready;
  const res = await realFetch(base + "/bookings", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{bad" });
  assert.strictEqual(res.status, 400);
  assert.strictEqual((await call("GET", "/nothing-here")).status, 404);
});

test("BK-16 cancel still works when the seats cannot be given back -> 200, seatsReleased false", async () => {
  const created = (await call("POST", "/bookings", valid())).body;
  releaseBroken = true;
  const r = await call("PATCH", `/bookings/${created.requestID}/cancel`, { email: EMAIL });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.status, "cancelled");
  assert.strictEqual(r.body.seatsReleased, false);
  assert.strictEqual(tables.BookingRequests.get(created.requestID).status, "cancelled");
});

test("BK-17 normal cancel says seatsReleased true", async () => {
  const created = (await call("POST", "/bookings", valid())).body;
  const r = await call("PATCH", `/bookings/${created.requestID}/cancel`, { email: EMAIL });
  assert.strictEqual(r.body.seatsReleased, true);
});

test.after(() => server.close());
