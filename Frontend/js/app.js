const packagesList = document.getElementById("packages-list");
const message = document.getElementById("message");
const packageForm = document.getElementById("package-form");

async function loadPackages() {
    try {
        message.textContent = "Loading packages...";
        const response = await fetch(`${API_BASE_URL}/packages`);
        if (!response.ok) {
            throw new Error("Packages could not load.");
        }
        const packages = await response.json();
        packagesList.innerHTML = "";
        if (packages.length === 0) {
            message.textContent = "No available packages now.";
            return;
        }
        message.textContent = "";
        packages.forEach((pkg) => {
            const card = document.createElement("div");
            card.className = "package-card";
            card.innerHTML = `
            <h3>${pkg.title}</h3>
            <p><strong>Destination:</strong> ${pkg.destination}</p>
            <p><strong>Start:</strong> ${pkg.startDate}</p>
            <p><strong>End:</strong> ${pkg.endDate}</p>
            <p><strong>Price:</strong> ${pkg.price} EGP</p>
            <p><strong>Seats left:</strong> ${pkg.seatsLeft}</p>`;
            packagesList.appendChild(card);

        });

    } catch (error) {
        message.textContent = error.message;
        console.error(error);
    }
}

packageForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
        message.textContent = "Creating package...";
        const packageData = {
            title: document.getElementById("title").value,
            destination: document.getElementById("destination").value,
            startDate: document.getElementById("startDate").value,
            endDate: document.getElementById("endDate").value,
            itinerary: document.getElementById("itinerary").value
            .split("\n")
            .map(activity => activity.trim())
            .filter(activity => activity !== ""),
            price: Number(document.getElementById("price").value),
            totalSeats: Number(document.getElementById("totalSeats").value)
            
        };
        const response = await fetch(`${API_BASE_URL}/packages`, {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify(packageData)
        });
        const result = await response.json();
        if (!response.ok) {
            throw new Error(result.message || "Package could not be created.");
        }
        packageForm.reset();
        await loadPackages();
        message.textContent = "Package created successfully. It may need to be published before appearing in the public list.";
    } catch (error) {
        message.textContent = error.message;
        console.error(error);
    }
});

loadPackages();