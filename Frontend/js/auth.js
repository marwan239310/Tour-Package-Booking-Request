// Shared login helpers for every page (Amazon Cognito on Floci).
// Load it after auth-config.js:  <script src="js/auth-config.js"></script> <script src="js/auth.js"></script>
const AUTH_KEY = "tourBookingAuth";

// Call one Cognito action (same JSON API the AWS SDK uses)
async function cognitoCall(action, body) {
    const response = await fetch(`${COGNITO_URL}/`, {
        method: "POST",
        headers: {
            "Content-Type": "application/x-amz-json-1.1",
            "X-Amz-Target": `AWSCognitoIdentityProviderService.${action}`
        },
        body: JSON.stringify(body)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
        const error = new Error(result.message || result.Message || "The login service did not answer.");
        error.code = result.__type;
        throw error;
    }
    return result;
}

// Read what is inside a token (email, groups, expiry). The APIs check the signature, not this page.
function readToken(token) {
    const part = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = decodeURIComponent(atob(part).split("")
        .map((c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0")).join(""));
    return JSON.parse(json);
}

// Log in with email + password. Returns { email, groups, idToken, expiresAt }
async function signIn(email, password) {
    const result = await cognitoCall("InitiateAuth", {
        AuthFlow: "USER_PASSWORD_AUTH",
        ClientId: COGNITO_CLIENT_ID,
        AuthParameters: { USERNAME: email, PASSWORD: password }
    });
    if (!result.AuthenticationResult) {
        throw new Error("This account needs an extra login step that this site does not support.");
    }
    const idToken = result.AuthenticationResult.IdToken;
    const claims = readToken(idToken);
    const session = {
        idToken,
        email: claims.email,
        groups: claims["cognito:groups"] || [],
        expiresAt: claims.exp * 1000
    };
    sessionStorage.setItem(AUTH_KEY, JSON.stringify(session));
    return session;
}

// The current login, or null (not logged in, or the token expired)
function getSession() {
    try {
        const session = JSON.parse(sessionStorage.getItem(AUTH_KEY));
        if (!session || Date.now() >= session.expiresAt) {
            sessionStorage.removeItem(AUTH_KEY);
            return null;
        }
        return session;
    } catch (error) {
        return null;
    }
}

function isStaff(session) {
    return Boolean(session && session.groups.includes("staff"));
}

function signOut() {
    sessionStorage.removeItem(AUTH_KEY);
    window.location.href = "login.html";
}

// Protect a page: requireLogin() for any user, requireLogin("staff") for staff only.
// Returns the session, or null after sending the user to the login page.
function requireLogin(role) {
    const session = getSession();
    const thisPage = window.location.pathname.split("/").pop() || "index.html";
    if (!session) {
        window.location.href = `login.html?next=${encodeURIComponent(thisPage)}`;
        return null;
    }
    if (role === "staff" && !isStaff(session)) {
        window.location.href = "login.html?denied=1";
        return null;
    }
    return session;
}

// Headers to send to our APIs: the token proves who the user is
function authHeaders() {
    const session = getSession();
    return session ? { Authorization: `Bearer ${session.idToken}` } : {};
}

// Navigation bar: "Sign in" when nobody is logged in, otherwise "email (role) | Sign out"
function showUserBar() {
    const nav = document.querySelector(".top-nav");
    if (!nav) return;
    const session = getSession();

    if (!session) {
        const thisPage = window.location.pathname.split("/").pop() || "index.html";
        const link = document.createElement("a");
        link.href = `login.html?next=${encodeURIComponent(thisPage)}`;
        link.textContent = "Sign in";
        nav.appendChild(link);
        return;
    }

    const who = document.createElement("span");
    who.className = "user-info";
    who.textContent = `${session.email} (${isStaff(session) ? "staff" : "customer"})`;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "link-button";
    button.textContent = "Sign out";
    button.addEventListener("click", signOut);
    nav.appendChild(who);
    nav.appendChild(button);
}