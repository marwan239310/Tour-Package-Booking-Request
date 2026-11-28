// Login page: sign in with Cognito, then go to the right page for the user's role
const loginForm = document.getElementById("login-form");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const loginButton = document.getElementById("login-button");
const message = document.getElementById("message");
const params = new URLSearchParams(window.location.search);

function showMessage(text, type) {
    message.textContent = text;
    message.className = type || "";
}

// After login, go back to the page the user wanted (only our own pages, never another website).
// Otherwise: staff go to the staff page, customers go to the packages page.
function nextPage(session) {
    const next = params.get("next");
    if (next && /^[a-z-]+\.html$/.test(next) && next !== "login.html") return next;
    return isStaff(session) ? "staff.html" : "index.html";
}

if (params.get("denied")) {
    showMessage("That page is for staff only. Please sign in with a staff account.", "error");
} else if (getSession()) {
    showMessage(`You are already signed in as ${getSession().email}.`, "success");
}

loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = emailInput.value.trim().toLowerCase();
    const password = passwordInput.value;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return showMessage("Please enter a valid email.", "error");
    if (!password) return showMessage("Please enter your password.", "error");

    try {
        loginButton.disabled = true;
        showMessage("Signing in...");
        const session = await signIn(email, password);
        passwordInput.value = "";
        window.location.href = nextPage(session);
    } catch (error) {
        console.error(error);
        if (error instanceof TypeError) {
            showMessage("The login service could not be reached. Is Floci running?", "error");
        } else if (String(error.code).includes("NotAuthorized") || String(error.code).includes("UserNotFound")) {
            // The same message for a wrong email or a wrong password, so nobody can find out which emails exist
            showMessage("Wrong email or password.", "error");
        } else {
            showMessage(error.message, "error");
        }
        loginButton.disabled = false;
    }
});