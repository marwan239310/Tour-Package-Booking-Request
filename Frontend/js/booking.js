// Booking page: loads the published packages (package service) and sends a booking request (booking service)
const bookingForm = document.getElementById("booking-form");
const packageSelect = document.getElementById("packageID");
const packageSummary = document.getElementById("package-summary");
const travelersInput = document.getElementById("travelers");
const totalPrice = document.getElementById("total-price");
const submitButton = document.getElementById("submit-button");
const message = document.getElementById("message");

let packagesById = {};

function showMessage(text, type) {
    message.textContent = text;
    message.className = type || "";
}

function updateSummary() {
    const pkg = packagesById[packageSelect.value];
    if (!pkg) {
        packageSummary.hidden = true;
        totalPrice.textContent = "";
        return;
    }
    packageSummary.hidden = false;
    packageSummary.textContent =
        `${pkg.destination} | ${pkg.startDate} to ${pkg.endDate} | ${pkg.price} EGP per person | ${pkg.seatsLeft} seats left`;
    travelersInput.max = Math.min(10, pkg.seatsLeft);
    const count = Number(travelersInput.value) || 0;
    totalPrice.textContent = count > 0 ? `Total: ${count * Number(pkg.price)} EGP` : "";
}

async function loadPackages() {
    try {
        const response = await fetch(`${API_BASE_URL}/packages`);
        if (!response.ok) throw new Error("Packages could not load.");
        const packages = await response.json();

        packageSelect.innerHTML = "";
        const placeholder = document.createElement("option");
        placeholder.value = "";
        placeholder.textContent = packages.length ? "Choose a package" : "No packages available now";
        packageSelect.appendChild(placeholder);

        packages
            .filter((pkg) => Number(pkg.seatsLeft) > 0)
            .forEach((pkg) => {
                packagesById[pkg.packageID] = pkg;
                const option = document.createElement("option");
                option.value = pkg.packageID;
                option.textContent = `${pkg.title} - ${pkg.destination} (${pkg.seatsLeft} seats left)`;
                packageSelect.appendChild(option);
            });

        // Open the page with a package already chosen: booking.html?packageID=...
        const chosen = new URLSearchParams(window.location.search).get("packageID");
        if (chosen && packagesById[chosen]) packageSelect.value = chosen;
        updateSummary();
    } catch (error) {
        showMessage(error.message, "error");
        console.error(error);
    }
}

// Check the form in the browser first (the server checks again)
function checkForm(data) {
    if (!data.packageID) return "Please choose a package.";
    if (data.customerName.length < 3) return "Full name must be at least 3 characters.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.customerEmail)) return "Please enter a valid email.";
    if (!/^\+?[0-9]{8,15}$/.test(data.phone.replace(/[\s-]/g, ""))) return "Phone number must be 8 to 15 digits.";
    if (!Number.isInteger(data.travelers) || data.travelers < 1 || data.travelers > 10) {
        return "Travelers must be a whole number from 1 to 10.";
    }
    const pkg = packagesById[data.packageID];
    if (pkg && data.travelers > pkg.seatsLeft) return `Only ${pkg.seatsLeft} seats are left for this package.`;
    return null;
}

bookingForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const bookingData = {
        packageID: packageSelect.value,
        customerName: document.getElementById("customerName").value.trim(),
        customerEmail: document.getElementById("customerEmail").value.trim(),
        phone: document.getElementById("phone").value.trim(),
        travelers: Number(travelersInput.value),
        note: document.getElementById("note").value.trim() || undefined
    };
    const error = checkForm(bookingData);
    if (error) return showMessage(error, "error");

    submitButton.disabled = true;
    showMessage("Sending booking request...");
    try {
        const response = await fetch(`${BOOKING_API_URL}/bookings`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(bookingData)
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message || "Booking request could not be sent.");

        // Remember the email so "My requests" opens with it
        try { localStorage.setItem("bookingEmail", bookingData.customerEmail); } catch (e) { /* ignore */ }
        bookingForm.reset();
        packagesById = {};
        await loadPackages();
        showMessage(
            `Booking request sent! Your request number is ${result.requestID}. Status: ${result.status}. ` +
            `Total: ${result.totalPrice} EGP. You can follow it on the "My requests" page.`,
            "success"
        );
    } catch (err) {
        showMessage(err.message, "error");
        console.error(err);
    } finally {
        submitButton.disabled = false;
    }
});

packageSelect.addEventListener("change", updateSummary);
travelersInput.addEventListener("input", updateSummary);
loadPackages();
