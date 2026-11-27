// Talks to the package service (Marwan) over HTTP.
// When staff reject or cancel a request, the seats that were reserved when the
// customer submitted it (Karim's service) are given back to the package.
const PACKAGE_SERVICE_URL = () => (process.env.PACKAGE_SERVICE_URL || "").replace(/\/$/, "");

// Returns true if the seats were given back, false if not (the reason is logged)
async function releaseSeats(packageID, travelers) {
  if (!PACKAGE_SERVICE_URL()) {
    console.log("Seats not released: PACKAGE_SERVICE_URL is not set");
    return false;
  }

  const response = await fetch(
    `${PACKAGE_SERVICE_URL()}/packages/${encodeURIComponent(packageID)}/release`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ travelers: Number(travelers) })
    }
  );

  if (!response.ok) {
    const details = await response.text();
    console.log(`Seats not released for ${packageID} (package service answered ${response.status}): ${details}`);
    return false;
  }

  console.log(`Seats released: ${travelers} back to package ${packageID}`);
  return true;
}

module.exports = {
  releaseSeats
};