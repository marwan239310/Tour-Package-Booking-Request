// "My requests" page: list my requests (by email), show history, change travelers, cancel
const searchForm = document.getElementById("search-form");
const emailInput = document.getElementById("email");
const statusFilter = document.getElementById("status-filter");
const bookingsList = document.getElementById("bookings-list");
const message = document.getElementById("message");

const CANCELLABLE = ["pending", "under_review", "confirmed", "awaiting_payment"];
const STATUS_LABELS = {
    pending: "Pending",
    under_review: "Under review",
    confirmed: "Confirmed",
    awaiting_payment: "Awaiting payment",
    accepted: "Accepted",
    rejected: "Rejected",
    cancelled: "Cancelled"
};

let currentEmail = "";

function showMessage(text, type) {
    message.textContent = text;
    message.className = type || "";
}

// Small helper: create an element with text (textContent, so user text is never run as HTML)
function el(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
}

function line(label, value) {
    const p = el("p");
    p.appendChild(el("strong", label + ": "));
    p.appendChild(document.createTextNode(value));
    return p;
}

async function readJson(response, fallback) {
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.message || fallback);
    return result;
}

async function loadMyBookings() {
    try {
        showMessage("Loading your requests...");
        const query = new URLSearchParams({ email: currentEmail });
        if (statusFilter.value) query.set("status", statusFilter.value);
        const bookings = await readJson(
            await fetch(`${BOOKING_API_URL}/bookings?${query}`),
            "Your requests could not load."
        );
        bookingsList.innerHTML = "";
        if (bookings.length === 0) {
            showMessage("No booking requests found for this email.");
            return;
        }
        showMessage(`${bookings.length} request(s) found.`);
        bookings.forEach((booking) => bookingsList.appendChild(renderBooking(booking)));
    } catch (error) {
        showMessage(error.message, "error");
        console.error(error);
    }
}

function renderBooking(booking) {
    const card = el("div", undefined, "package-card booking-card");
    const title = el("h3", booking.packageTitle || booking.packageID);
    const badge = el("span", STATUS_LABELS[booking.status] || booking.status, `status-badge status-${booking.status}`);
    title.appendChild(badge);
    card.appendChild(title);
    card.appendChild(line("Request number", booking.requestID));
    card.appendChild(line("Travelers", String(booking.travelers)));
    if (booking.totalPrice !== undefined) card.appendChild(line("Total", `${booking.totalPrice} EGP`));
    card.appendChild(line("Sent on", booking.createdAt));
    if (booking.rejectionReason) card.appendChild(line("Reason", booking.rejectionReason));

    const actions = el("div", undefined, "card-actions");

    // Change travelers: only while pending
    if (booking.status === "pending") {
        const input = el("input");
        input.type = "number";
        input.min = "1";
        input.max = "10";
        input.value = booking.travelers;
        input.setAttribute("aria-label", "New number of travelers");
        const saveButton = el("button", "Change travelers", "secondary");
        saveButton.addEventListener("click", () => changeTravelers(booking.requestID, Number(input.value)));
        actions.appendChild(input);
        actions.appendChild(saveButton);
    }

    // Cancel: only in a cancellable status
    if (CANCELLABLE.includes(booking.status)) {
        const cancelButton = el("button", "Cancel request", "danger");
        cancelButton.addEventListener("click", () => cancelBooking(booking.requestID));
        actions.appendChild(cancelButton);
    }

    // Status history
    const historyButton = el("button", "Show history", "secondary");
    const historyBox = el("ol", undefined, "history");
    historyBox.hidden = true;
    historyButton.addEventListener("click", () => toggleHistory(booking.requestID, historyBox, historyButton));
    actions.appendChild(historyButton);

    card.appendChild(actions);
    card.appendChild(historyBox);
    return card;
}

async function toggleHistory(requestID, box, button) {
    if (!box.hidden) {
        box.hidden = true;
        button.textContent = "Show history";
        return;
    }
    try {
        const query = new URLSearchParams({ email: currentEmail });
        const booking = await readJson(
            await fetch(`${BOOKING_API_URL}/bookings/${encodeURIComponent(requestID)}?${query}`),
            "History could not load."
        );
        box.innerHTML = "";
        booking.history.forEach((h) => {
            const when = new Date(h.changedAt).toLocaleString();
            const text = `${when}: ${h.fromStatus ? STATUS_LABELS[h.fromStatus] || h.fromStatus : "New"} → ` +
                `${STATUS_LABELS[h.toStatus] || h.toStatus}` +
                (h.reason ? ` (reason: ${h.reason})` : "") + (h.note ? ` - ${h.note}` : "");
            box.appendChild(el("li", text));
        });
        box.hidden = false;
        button.textContent = "Hide history";
    } catch (error) {
        showMessage(error.message, "error");
    }
}

async function changeTravelers(requestID, travelers) {
    if (!Number.isInteger(travelers) || travelers < 1 || travelers > 10) {
        return showMessage("Travelers must be a whole number from 1 to 10.", "error");
    }
    try {
        await readJson(
            await fetch(`${BOOKING_API_URL}/bookings/${encodeURIComponent(requestID)}/travelers`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email: currentEmail, travelers })
            }),
            "The number of travelers could not be changed."
        );
        await loadMyBookings();
        showMessage(`Request ${requestID} now has ${travelers} traveler(s).`, "success");
    } catch (error) {
        showMessage(error.message, "error");
    }
}

async function cancelBooking(requestID) {
    if (!confirm(`Cancel request ${requestID}? This cannot be undone.`)) return;
    try {
        await readJson(
            await fetch(`${BOOKING_API_URL}/bookings/${encodeURIComponent(requestID)}/cancel`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email: currentEmail })
            }),
            "Request could not be cancelled."
        );
        await loadMyBookings();
        showMessage(`Request ${requestID} was cancelled. The seats were given back.`, "success");
    } catch (error) {
        showMessage(error.message, "error");
    }
}

searchForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const email = emailInput.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return showMessage("Please enter a valid email.", "error");
    }
    currentEmail = email;
    try { localStorage.setItem("bookingEmail", email); } catch (e) { /* ignore */ }
    loadMyBookings();
});

statusFilter.addEventListener("change", () => {
    if (currentEmail) loadMyBookings();
});

// Fill in the email used last time
try {
    const saved = localStorage.getItem("bookingEmail");
    if (saved) {
        emailInput.value = saved;
        currentEmail = saved;
        loadMyBookings();
    }
} catch (e) { /* ignore */ }
