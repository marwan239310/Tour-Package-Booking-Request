// Staff-only guard for package management endpoints.
//
// Expects "Authorization: Bearer <Cognito ID or access token>" from the team
// login. The token signature is verified against the user pool's JWKS, then
// the issuer, expiry, app client and staff group are checked.
//
// Environment variables:
//   COGNITO_ISSUER     issuer written in the tokens (required)
//   COGNITO_JWKS_URL   where to download the signing keys
//                      (default: COGNITO_ISSUER + "/.well-known/jwks.json")
//   COGNITO_CLIENT_ID  app client id to accept (optional but recommended)
//   STAFF_GROUP        Cognito group that counts as staff (default "staff";
//                      set to an empty string to accept any signed-in user)

const crypto = require("crypto");

const JWKS_CACHE_MS = 10 * 60 * 1000;
let jwksCache = { keys: [], fetchedAt: 0 };

function settings() {
    const issuer = (process.env.COGNITO_ISSUER || "").replace(/\/+$/, "");
    return {
        issuer,
        jwksUrl: process.env.COGNITO_JWKS_URL || (issuer ? `${issuer}/.well-known/jwks.json` : ""),
        clientId: process.env.COGNITO_CLIENT_ID || "",
        staffGroup: process.env.STAFF_GROUP === undefined ? "staff" : process.env.STAFF_GROUP
    };
}

class AuthError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

function decodePart(part) {
    return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
}

async function loadKeys(jwksUrl, force = false) {
    const fresh = Date.now() - jwksCache.fetchedAt < JWKS_CACHE_MS;
    if (!force && fresh && jwksCache.keys.length > 0) {
        return jwksCache.keys;
    }

    const response = await fetch(jwksUrl);
    if (!response.ok) {
        throw new Error(`Could not download Cognito keys (HTTP ${response.status})`);
    }

    const body = await response.json();
    jwksCache = { keys: body.keys || [], fetchedAt: Date.now() };
    return jwksCache.keys;
}

async function findKey(jwksUrl, kid) {
    let key = (await loadKeys(jwksUrl)).find(k => k.kid === kid);
    if (!key) {
        // Keys may have rotated; refresh once
        key = (await loadKeys(jwksUrl, true)).find(k => k.kid === kid);
    }
    return key;
}

async function verifyToken(token, config) {
    const parts = token.split(".");
    if (parts.length !== 3) {
        throw new AuthError(401, "Malformed token");
    }

    let header;
    let claims;
    try {
        header = decodePart(parts[0]);
        claims = decodePart(parts[1]);
    } catch {
        throw new AuthError(401, "Malformed token");
    }

    if (header.alg !== "RS256") {
        throw new AuthError(401, "Unsupported token algorithm");
    }

    const jwk = await findKey(config.jwksUrl, header.kid);
    if (!jwk) {
        throw new AuthError(401, "Unknown signing key");
    }

    const validSignature = crypto.verify(
        "RSA-SHA256",
        Buffer.from(`${parts[0]}.${parts[1]}`),
        crypto.createPublicKey({ key: jwk, format: "jwk" }),
        Buffer.from(parts[2], "base64url")
    );
    if (!validSignature) {
        throw new AuthError(401, "Invalid token signature");
    }

    const now = Math.floor(Date.now() / 1000);
    if (typeof claims.exp !== "number" || claims.exp <= now) {
        throw new AuthError(401, "Token has expired");
    }

    if ((claims.iss || "").replace(/\/+$/, "") !== config.issuer) {
        throw new AuthError(401, "Token was not issued by the team user pool");
    }

    if (claims.token_use !== "id" && claims.token_use !== "access") {
        throw new AuthError(401, "Unsupported token type");
    }

    if (config.clientId) {
        const tokenClient = claims.token_use === "id" ? claims.aud : claims.client_id;
        if (tokenClient !== config.clientId) {
            throw new AuthError(401, "Token belongs to a different app client");
        }
    }

    return claims;
}

async function requireStaff(req, res, next) {
    const config = settings();

    if (!config.issuer || !config.jwksUrl) {
        return res.status(503).json({
            message: "Staff login is not configured on the package service"
        });
    }

    const match = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || "");
    if (!match) {
        return res.status(401).json({ message: "Staff login required" });
    }

    try {
        const claims = await verifyToken(match[1].trim(), config);
        const groups = claims["cognito:groups"] || [];

        if (config.staffGroup && !groups.includes(config.staffGroup)) {
            return res.status(403).json({ message: "Only staff can manage packages" });
        }

        req.user = {
            sub: claims.sub,
            email: claims.email,
            username: claims["cognito:username"] || claims.username,
            groups
        };
        return next();
    } catch (error) {
        if (error instanceof AuthError) {
            return res.status(error.status).json({ message: error.message });
        }

        console.error("Staff token verification failed:", error);
        return res.status(503).json({ message: "Could not verify staff login" });
    }
}

// Lets the public list stay open, but drafts (unpublished packages) are staff only
function requireStaffForDrafts(req, res, next) {
    const wantsDrafts =
        String(req.query.isPublished).toLowerCase() === "false" ||
        String(req.query.includeUnpublished).toLowerCase() === "true";

    return wantsDrafts ? requireStaff(req, res, next) : next();
}

module.exports = {
    requireStaff,
    requireStaffForDrafts,
    // exported for tests
    _resetKeyCache: () => { jwksCache = { keys: [], fetchedAt: 0 }; }
};
