// Login check (Amazon Cognito) for the staff routes.
// The website sends "Authorization: Bearer <ID token>". We check, without trusting the browser:
//   1. the token is signed by OUR Cognito user pool (RS256 signature with the pool's public keys)
//   2. it is not expired, it is an ID token, and it was made for OUR website (app client)
//   3. the user is in the "staff" group
// 401 = not logged in / bad token, 403 = logged in but not staff.
const crypto = require("crypto");

const KEYS_MAX_AGE = 60 * 60 * 1000;   // download the public keys again after 1 hour
let cachedKeys = null;
let cachedAt = 0;

function httpError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

// The pool's public keys (JWKS). They are public: anyone may download them to check tokens.
async function getKeys(forceRefresh) {
  if (!forceRefresh && cachedKeys && Date.now() - cachedAt < KEYS_MAX_AGE) return cachedKeys;
  let response;
  try {
    response = await fetch(process.env.COGNITO_JWKS_URL);
  } catch (error) {
    throw httpError(`Login keys could not be downloaded: ${error.message}`, 503);
  }
  if (!response.ok) throw httpError(`Login keys could not be downloaded (status ${response.status})`, 503);
  cachedKeys = (await response.json()).keys || [];
  cachedAt = Date.now();
  return cachedKeys;
}

function readPart(part) {
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
}

async function verifyToken(token) {
  const parts = token.split(".");
  if (parts.length !== 3) throw httpError("The token is not in the right format", 401);

  let header;
  let claims;
  try {
    header = readPart(parts[0]);
    claims = readPart(parts[1]);
  } catch (error) {
    throw httpError("The token is not in the right format", 401);
  }
  if (header.alg !== "RS256") throw httpError("The token uses an unexpected algorithm", 401);

  // Find the key the token was signed with (download the keys again once, in case they changed)
  let key = (await getKeys(false)).find((k) => k.kid === header.kid);
  if (!key) key = (await getKeys(true)).find((k) => k.kid === header.kid);
  if (!key) throw httpError("The token was not signed by our login service", 401);

  const signatureOk = crypto.verify(
    "RSA-SHA256",
    Buffer.from(`${parts[0]}.${parts[1]}`),
    crypto.createPublicKey({ key, format: "jwk" }),
    Buffer.from(parts[2], "base64url")
  );
  if (!signatureOk) throw httpError("The token signature is not valid", 401);

  const now = Math.floor(Date.now() / 1000);
  if (!claims.exp || claims.exp <= now) throw httpError("The login has expired", 401);
  if (claims.iss !== process.env.COGNITO_ISSUER) throw httpError("The token is from another login service", 401);
  if (claims.token_use !== "id") throw httpError("The token is not an ID token", 401);
  if (claims.aud !== process.env.COGNITO_CLIENT_ID) throw httpError("The token was made for another app", 401);
  return claims;
}

// Express middleware: only signed-in staff can go on
function requireStaff(req, res, next) {
  const match = /^Bearer (\S+)$/.exec(req.headers.authorization || "");
  if (!match) return res.status(401).json({ message: "Please sign in as staff" });

  verifyToken(match[1]).then(
    (claims) => {
      const groups = claims["cognito:groups"] || [];
      if (!groups.includes("staff")) {
        return res.status(403).json({ message: "This is for staff only" });
      }
      req.user = { email: claims.email, groups };
      next();
    },
    (error) => {
      console.log("Login check failed:", error.message);
      if (error.statusCode === 503) {
        return res.status(503).json({ message: "The login check is not available right now" });
      }
      res.status(401).json({ message: "Your login is not valid. Please sign in again." });
    }
  );
}

module.exports = { requireStaff, verifyToken };