// Staff page: dashboard counts, filter requests, change status (reason / note), see history
// Staff only: requireLogin("staff") sends everyone else to the login page (auth.js).
// Every call to the API sends the login token; the API checks it again (401 / 403).
const session = requireLogin("staff");

const countsBox = document.getElementById("counts");
const filterForm = document.getElementById("filter-form");
const statusFilter = document.getElementById("status-filter");
const packageFilter = document.getElementById("package-filter");
const dateFilter = document.getElementById("date-filter");
const clearButton = document.getElementById("clear-filters");
const requestsList = document.getElementById("requests-list");
const message = document.getElementById("message");

const STATUS_LABELS = {
    pending: "Pending",
    under_review: "Under review",
    confirmed: "Confirmed",
    awaiting_payment: "Awaiting payment",
    accepted: "Accepted",
    rejected: "Rejected",
    cancelled: "Cancelled"
};

// The same status flow as the service (requestService.js). The service checks it again,
// so this is only to show staff the choices that are allowed.
const ALLOWED_NEXT = {
    pending: ["under_review", "rejected", "cancelled"],
    under_review: ["confirmed", "rejected", "cancelled"],
    confirmed: ["awaiting_payment", "cancelled"],
    awaiting_payment: ["accepted", "cancelled"],
    accepted: [],
    rejected: [],
    cancelled: []
};

function showMessage(text, type) {
    message.textContent = text;
    message.className = type || "";
}

// Create an element with text (textContent, so customer text is never run as HTML)
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

// Read the JSON answer; if the service answered with an error, throw its message
async function readJson(response, fallback) {
    // 401: the login expired or is not valid any more -> sign in again
    if (response.status === 401) {
        signOut();
        throw new Error("Please sign in again.");
    }
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.message || fallback);
    return result;
}

// ---------- Dashboard (GET /requests/count) ----------
async function loadCounts() {
    try {
        const counts = await readJson(
            await fetch(`${REVIEW_API_URL}/requests/count`, { headers: authHeaders() }),
            "The counts could not load."
        );
        countsBox.innerHTML = "";
        countsBox.appendChild(countTile("All requests", counts.total, ""));
        Object.keys(STATUS_LABELS).forEach((status) => {
            countsBox.appendChild(countTile(STATUS_LABELS[status], counts.byStatus[status] || 0, status));
        });
    } catch (error) {
        countsBox.textContent = error.message;
        console.error(error);
    }
}

function countTile(label, number, status) {
    const tile = el("button", undefined, "count-tile" + (status ? ` status-${status}` : ""));
    tile.type = "button";
    tile.appendChild(el("strong", String(number)));
    tile.appendChild(el("span", label));
    tile.addEventListener("click", () => {
        statusFilter.value = status;
        loadRequests();
    });
    return tile;
}

// ---------- Requests list (GET /requests?status=&packageID=&date=) ----------
async function loadRequests() {
    try {
        showMessage("Loading requests...");
        const query = new URLSearchParams();
        if (statusFilter.value) query.set("status", statusFilter.value);
        if (packageFilter.value.trim()) query.set("packageID", packageFilter.value.trim());
        if (dateFilter.value) query.set("date", dateFilter.value);

        const requests = await readJson(
            await fetch(`${REVIEW_API_URL}/requests?${query}`, { headers: authHeaders() }),
            "The requests could not load."
        );
        requestsList.innerHTML = "";
        if (requests.length === 0) {
            showMessage("No requests match these filters.");
            return;
        }
        showMessage(`${requests.length} request(s) found.`);
        requests.forEach((request) => requestsList.appendChild(renderRequest(request)));
    } catch (error) {
        showMessage(error.message, "error");
        console.error(error);
    }
}

function renderRequest(request) {
    const card = el("div", undefined, "request-card");
    const title = el("h3", request.requestID);
    title.appendChild(el("span", STATUS_LABELS[request.status] || request.status,
        `status-badge status-${request.status}`));
    card.appendChild(title);

    card.appendChild(line("Customer", request.customerName || "-"));
    card.appendChild(line("Email", request.customerEmail || "-"));
    if (request.phone) card.appendChild(line("Phone", request.phone));
    card.appendChild(line("Package", request.packageTitle
        ? `${request.packageTitle} (${request.packageID})` : request.packageID));
    card.appendChild(line("Travelers", String(request.travelers)));
    if (request.totalPrice !== undefined) card.appendChild(line("Total", `${request.totalPrice} EGP`));
    card.appendChild(line("Sent on", request.createdAt));
    if (request.note) card.appendChild(line("Customer note", request.note));
    if (request.rejectionReason) card.appendChild(line("Reject reason", request.rejectionReason));
    if (request.staffNote) card.appendChild(line("Staff note", request.staffNote));

    const next = ALLOWED_NEXT[request.status] || [];
    if (next.length > 0) {
        card.appendChild(statusForm(request, next));
    } else {
        card.appendChild(el("p", "Final status: no more changes.", "final"));
    }

    // Status history
    const actions = el("div", undefined, "card-actions");
    const historyButton = el("button", "Show history", "secondary");
    historyButton.type = "button";
    const historyBox = el("ol", undefined, "history");
    historyBox.hidden = true;
    historyButton.addEventListener("click", () => toggleHistory(request.requestID, historyBox, historyButton));
    actions.appendChild(historyButton);
    card.appendChild(actions);
    card.appendChild(historyBox);
    return card;
}

// The "change status" box: new status, reason (only for reject), staff note, button
function statusForm(request, next) {
    const form = el("form", undefined, "status-form");
    const id = request.requestID;

    const statusLabel = el("label", "New status");
    statusLabel.htmlFor = `status-${id}`;
    const select = el("select");
    select.id = `status-${id}`;
    select.appendChild(new Option("Choose...", ""));
    next.forEach((status) => select.appendChild(new Option(STATUS_LABELS[status], status)));

    const reasonLabel = el("label", "Reason for rejecting (at least 5 characters)");
    reasonLabel.htmlFor = `reason-${id}`;
    const reasonInput = el("input");
    reasonInput.id = `reason-${id}`;
    reasonInput.maxLength = 300;
    reasonLabel.hidden = true;
    reasonInput.hidden = true;

    const noteLabel = el("label", "Staff note (optional)");
    noteLabel.htmlFor = `note-${id}`;
    const noteInput = el("input");
    noteInput.id = `note-${id}`;
    noteInput.maxLength = 300;

    const button = el("button", "Update status");
    button.type = "submit";

    // Show the reason box only when "Rejected" is chosen
    select.addEventListener("change", () => {
        const rejecting = select.value === "rejected";
        reasonLabel.hidden = !rejecting;
        reasonInput.hidden = !rejecting;
    });

    form.addEventListener("submit", (event) => {
        event.preventDefault();
        updateStatus(id, select.value, reasonInput.value.trim(), noteInput.value.trim(), button);
    });

    [statusLabel, select, reasonLabel, reasonInput, noteLabel, noteInput, button]
        .forEach((node) => form.appendChild(node));
    return form;
}

// ---------- Change status (PATCH /requests/:id/status) ----------
async function updateStatus(requestID, status, reason, note, button) {
    // Check here first so staff get a clear message (the service checks again)
    if (!status) return showMessage("Choose the new status first.", "error");
    if (status === "rejected" && reason.length < 5) {
        return showMessage("Write a reason of at least 5 characters to reject.", "error");
    }
    if (note.length > 300) return showMessage("The staff note must be 300 characters or less.", "error");
    if ((status === "rejected" || status === "cancelled") &&
        !confirm(`${status === "rejected" ? "Reject" : "Cancel"} request ${requestID}? This cannot be undone.`)) return;

    const body = { status };
    if (status === "rejected") body.reason = reason;
    if (note) body.note = note;

    try {
        button.disabled = true;
        const result = await readJson(
            await fetch(`${REVIEW_API_URL}/requests/${encodeURIComponent(requestID)}/status`, {
                method: "PATCH",
                headers: { ...authHeaders(), "Content-Type": "application/json" },
                body: JSON.stringify(body)
            }),
            "The status could not be changed."
        );

        let text = `Request ${requestID} is now ${STATUS_LABELS[result.status]}.`;
        if (result.seatsReleased === true) text += " The seats were given back to the package.";
        if (result.seatsReleased === false) text += " Note: the seats could not be given back (package service not reachable).";
        text += result.notificationPublished
            ? " The customer will get an email."
            : " Note: the email could not be sent.";

        await loadAll();
        showMessage(text, "success");
    } catch (error) {
        showMessage(error.message, "error");
        button.disabled = false;
    }
}

// ---------- History (GET /requests/:id/history) ----------
async function toggleHistory(requestID, box, button) {
    if (!box.hidden) {
        box.hidden = true;
        button.textContent = "Show history";
        return;
    }
    try {
        const history = await readJson(
            await fetch(`${REVIEW_API_URL}/requests/${encodeURIComponent(requestID)}/history`, { headers: authHeaders() }),
            "The history could not load."
        );
        box.innerHTML = "";
        if (history.length === 0) box.appendChild(el("li", "No changes yet."));
        history.forEach((h) => {
            const when = new Date(h.changedAt).toLocaleString();
            const from = h.fromStatus ? STATUS_LABELS[h.fromStatus] || h.fromStatus : "New";
            const to = STATUS_LABELS[h.toStatus] || h.toStatus;
            const text = `${when}: ${from} → ${to}` +
                (h.changedBy ? ` (by ${h.changedBy})` : "") +
                (h.reason ? `, reason: ${h.reason}` : "") +
                (h.note ? ` - ${h.note}` : "");
            box.appendChild(el("li", text));
        });
        box.hidden = false;
        button.textContent = "Hide history";
    } catch (error) {
        showMessage(error.message, "error");
    }
}

function loadAll() {
    return Promise.all([loadCounts(), loadRequests()]);
}

filterForm.addEventListener("submit", (event) => {
    event.preventDefault();
    loadRequests();
});

clearButton.addEventListener("click", () => {
    statusFilter.value = "";
    packageFilter.value = "";
    dateFilter.value = "";
    loadRequests();
});

// Only load the data for signed-in staff
if (session) {
    showUserBar();
    loadAll();
}