const packagesList = document.getElementById("packages-list");
const manageList = document.getElementById("manage-list");
const manageSection = document.getElementById("manage-section");
const createSection = document.getElementById("create-package-section");
const message = document.getElementById("message");
const packageForm = document.getElementById("package-form");
const formTitle = document.getElementById("form-title");
const formSubmit = document.getElementById("form-submit");
const formCancel = document.getElementById("form-cancel");
const searchForm = document.getElementById("search-form");

const CURRENCIES = ["USD", "EUR", "GBP", "SAR", "AED", "KWD"];

// ID of the package being edited, or null when the form creates a new one
let editingPackageID = null;

function showMessage(text, isError = false) {
    message.textContent = text;
    message.classList.toggle("error", isError);
}

// ------------------------------------------
// Staff login: the team login page (login.html) and js/auth.js.
// Customers only browse; staff also see "Manage packages" and the create/edit form.
// The API checks the token again (401 = not logged in, 403 = not staff).
// ------------------------------------------

function updateStaffView() {
    const staff = isStaff(getSession());
    createSection.hidden = !staff;
    manageSection.hidden = !staff;

    if (staff) {
        loadManageList();
    } else {
        manageList.replaceChildren();
    }
}

// fetch() wrapper that sends the staff token and handles expired logins
async function staffFetch(url, options = {}) {
    if (!isStaff(getSession())) {
        throw new Error("Please sign in with a staff account first.");
    }

    const response = await fetch(url, {
        ...options,
        headers: {
            "Content-Type": "application/json",
            ...(options.headers || {}),
            ...authHeaders()
        }
    });

    const result = await response.json().catch(() => ({}));

    if (response.status === 401) {
        signOut();   // auth.js: clears the login and opens login.html
        throw new Error("Your staff login has expired. Please sign in again.");
    }
    if (response.status === 403) {
        throw new Error(result.message || "This account is not a staff account.");
    }
    if (!response.ok) {
        throw new Error(result.message || `Request failed (HTTP ${response.status}).`);
    }
    return result;
}

// Public GET that turns error answers into readable messages
async function publicGet(path) {
    const response = await fetch(`${API_BASE_URL}${path}`);
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(result.message || `Request failed (HTTP ${response.status}).`);
    }
    return result;
}

// ------------------------------------------
// Rendering (textContent only, never innerHTML, so package data cannot inject HTML)
// ------------------------------------------

function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
}

function addLine(parent, label, value) {
    const line = document.createElement("p");
    line.append(element("strong", `${label}:`), ` ${value ?? ""}`);
    parent.appendChild(line);
}

function button(text, onClick, className) {
    const node = element("button", text, className);
    node.type = "button";
    node.addEventListener("click", onClick);
    return node;
}

function tripDays(pkg) {
    const start = new Date(`${pkg.startDate}T00:00:00Z`);
    const end = new Date(`${pkg.endDate}T00:00:00Z`);
    const days = Math.round((end - start) / 86400000) + 1;
    return Number.isFinite(days) && days > 0 ? `${days} day${days === 1 ? "" : "s"}` : "";
}

function createPackageCard(pkg) {
    const card = element("div", undefined, "package-card");
    card.appendChild(element("h3", pkg.title));

    addLine(card, "Destination", pkg.destination);
    addLine(card, "Dates", `${pkg.startDate} to ${pkg.endDate}`);
    addLine(card, "Price", `${pkg.price} EGP`);
    addLine(card, "Seats left", pkg.seatsLeft === 0 ? "Fully booked" : pkg.seatsLeft);

    return card;
}

// Details panel: loads the package from the API, shows the itinerary and the currency converter
async function toggleDetails(pkg, card, toggleButton) {
    const existing = card.querySelector(".package-details");
    if (existing) {
        existing.remove();
        toggleButton.textContent = "View details";
        return;
    }

    toggleButton.disabled = true;
    try {
        const details = await publicGet(`/packages/${encodeURIComponent(pkg.packageID)}`);
        const panel = element("div", undefined, "package-details");

        addLine(panel, "Duration", tripDays(details));
        addLine(panel, "Total seats", details.totalSeats);
        panel.appendChild(element("strong", "Itinerary:"));
        const list = document.createElement("ol");
        (details.itinerary || []).forEach(activity => list.appendChild(element("li", activity)));
        panel.appendChild(list);

        // Currency conversion through the external exchange-rate API
        const converter = element("div", undefined, "converter");
        const label = element("label", "Price in:");
        const select = document.createElement("select");
        select.id = `currency-${details.packageID}`;
        label.htmlFor = select.id;
        CURRENCIES.forEach(code => {
            const option = element("option", code);
            option.value = code;
            select.appendChild(option);
        });
        const result = element("p", "", "converted-price");
        const convertButton = button("Convert", async () => {
            convertButton.disabled = true;
            result.textContent = "Getting today's rate...";
            try {
                const converted = await publicGet(
                    `/packages/${encodeURIComponent(details.packageID)}/convert?currency=${encodeURIComponent(select.value)}`
                );
                const dateText = converted.rateDate ? ` on ${converted.rateDate}` : "";
                result.textContent = `≈ ${converted.convertedAmount} ${converted.targetCurrency} (1 EGP = ${converted.exchangeRate} ${converted.targetCurrency}${dateText})`;
            } catch (error) {
                result.textContent = error.message;
            } finally {
                convertButton.disabled = false;
            }
        });
        converter.append(label, select, convertButton);
        panel.append(converter, result);

        card.querySelector(".card-actions").before(panel);
        toggleButton.textContent = "Hide details";
    } catch (error) {
        showMessage(error.message, true);
    } finally {
        toggleButton.disabled = false;
    }
}

function currentSearchQuery() {
    const params = new URLSearchParams();
    const destination = document.getElementById("search-destination").value.trim();
    const startDate = document.getElementById("search-start").value;
    const endDate = document.getElementById("search-end").value;
    const maxPrice = document.getElementById("search-max-price").value;

    if (destination) params.set("destination", destination);
    if (startDate) params.set("startDate", startDate);
    if (endDate) params.set("endDate", endDate);
    if (maxPrice !== "") params.set("maxPrice", maxPrice);
    return params;
}

async function loadPackages() {
    const params = currentSearchQuery();
    const searching = [...params.keys()].length > 0;

    try {
        showMessage(searching ? "Searching..." : "Loading packages...");
        const query = params.toString();
        const packages = await publicGet(`/packages${query ? `?${query}` : ""}`);
        packagesList.replaceChildren();

        if (packages.length === 0) {
            showMessage(searching ? "No packages match your search." : "No available packages now.");
            return;
        }

        showMessage(searching ? `${packages.length} package(s) found.` : "");
        packages.forEach((pkg) => {
            const card = createPackageCard(pkg);
            const actions = element("div", undefined, "card-actions");
            const detailsButton = button("View details", () => toggleDetails(pkg, card, detailsButton), "secondary");
            actions.appendChild(detailsButton);
            card.appendChild(actions);
            packagesList.appendChild(card);
        });
    } catch (error) {
        packagesList.replaceChildren();
        showMessage(error.message, true);
        console.error(error);
    }
}

async function loadManageList() {
    try {
        const packages = await staffFetch(`${API_BASE_URL}/packages?includeUnpublished=true`);
        manageList.replaceChildren();

        if (packages.length === 0) {
            manageList.appendChild(element("p", "No packages yet. Create one below."));
            return;
        }

        packages.forEach((pkg) => {
            const card = createPackageCard(pkg);
            card.insertBefore(
                element("span", pkg.isPublished ? "Published" : "Draft", pkg.isPublished ? "badge published" : "badge draft"),
                card.firstChild
            );

            const actions = element("div", undefined, "card-actions");
            actions.appendChild(button("Edit", () => startEditing(pkg), "secondary"));
            const publishButton = button(pkg.isPublished ? "Hide" : "Publish", () => setPublished(pkg, !pkg.isPublished, publishButton));
            actions.appendChild(publishButton);
            card.appendChild(actions);
            manageList.appendChild(card);
        });
    } catch (error) {
        showMessage(error.message, true);
        console.error(error);
    }
}

async function setPublished(pkg, publish, actionButton) {
    actionButton.disabled = true;
    try {
        await staffFetch(`${API_BASE_URL}/packages/${encodeURIComponent(pkg.packageID)}`, {
            method: "PUT",
            body: JSON.stringify({ isPublished: publish })
        });
        await Promise.all([loadPackages(), loadManageList()]);
        showMessage(publish
            ? `"${pkg.title}" is now published and can be booked.`
            : `"${pkg.title}" is hidden from customers.`);
    } catch (error) {
        actionButton.disabled = false;
        showMessage(error.message, true);
        console.error(error);
    }
}

// ------------------------------------------
// Create / edit form
// ------------------------------------------

function startEditing(pkg) {
    editingPackageID = pkg.packageID;
    document.getElementById("title").value = pkg.title;
    document.getElementById("destination").value = pkg.destination;
    document.getElementById("startDate").value = pkg.startDate;
    document.getElementById("endDate").value = pkg.endDate;
    document.getElementById("price").value = pkg.price;
    document.getElementById("totalSeats").value = pkg.totalSeats;
    document.getElementById("itinerary").value = (pkg.itinerary || []).join("\n");
    document.getElementById("publishNow").checked = pkg.isPublished;

    formTitle.textContent = `Edit "${pkg.title}"`;
    formSubmit.textContent = "Save changes";
    formCancel.hidden = false;
    createSection.scrollIntoView({ behavior: "smooth" });
}

function stopEditing() {
    editingPackageID = null;
    packageForm.reset();
    formTitle.textContent = "Create a tour package";
    formSubmit.textContent = "Create Package";
    formCancel.hidden = true;
}

function readPackageForm() {
    const data = {
        title: document.getElementById("title").value.trim(),
        destination: document.getElementById("destination").value.trim(),
        startDate: document.getElementById("startDate").value,
        endDate: document.getElementById("endDate").value,
        itinerary: document.getElementById("itinerary").value
            .split("\n")
            .map(activity => activity.trim())
            .filter(activity => activity !== ""),
        price: Number(document.getElementById("price").value),
        totalSeats: Number(document.getElementById("totalSeats").value),
        isPublished: document.getElementById("publishNow").checked
    };

    // Quick checks in the browser; the API checks everything again
    if (data.endDate < data.startDate) {
        throw new Error("End date cannot be before the start date.");
    }
    if (data.itinerary.length === 0) {
        throw new Error("Add at least one itinerary activity.");
    }
    return data;
}

// ------------------------------------------
// Events
// ------------------------------------------

searchForm.addEventListener("submit", (event) => {
    event.preventDefault();
    loadPackages();
});

document.getElementById("search-clear").addEventListener("click", () => {
    searchForm.reset();
    loadPackages();
});

formCancel.addEventListener("click", stopEditing);

packageForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
        const packageData = readPackageForm();
        const editing = Boolean(editingPackageID);
        showMessage(editing ? "Saving changes..." : "Creating package...");

        await staffFetch(
            editing
                ? `${API_BASE_URL}/packages/${encodeURIComponent(editingPackageID)}`
                : `${API_BASE_URL}/packages`,
            {
                method: editing ? "PUT" : "POST",
                body: JSON.stringify(packageData)
            }
        );

        stopEditing();
        await Promise.all([loadPackages(), loadManageList()]);
        if (editing) {
            showMessage("Package updated.");
        } else {
            showMessage(packageData.isPublished
                ? "Package created and published."
                : "Package created as a draft. Use its Publish button when it is ready.");
        }
    } catch (error) {
        showMessage(error.message, true);
        console.error(error);
    }
});

showUserBar();
updateStaffView();
loadPackages();