// Talks to the package service (Marwan) over HTTP.
// The booking service never writes to the Packages table directly: it asks the package service.

const PACKAGE_SERVICE_URL = () => (process.env.PACKAGE_SERVICE_URL || "http://localhost:3001").replace(/\/$/, "");

function serviceError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

// Returns the package, or null if it does not exist
async function getPackage(packageID) {
  let response;
  try {
    response = await fetch(`${PACKAGE_SERVICE_URL()}/packages/${encodeURIComponent(packageID)}`);
  } catch (error) {
    throw serviceError("The package service is not available. Please try again later.", 503);
  }
  if (response.status === 404) return null;
  if (!response.ok) throw serviceError("The package service is not available. Please try again later.", 503);
  return response.json();
}

// Sets the number of free seats of a package (the package service checks 0 <= seats <= totalSeats)
async function setSeatsLeft(packageID, seatsLeft) {
  let response;
  try {
    response = await fetch(`${PACKAGE_SERVICE_URL()}/packages/${encodeURIComponent(packageID)}/seats`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ seatsLeft })
    });
  } catch (error) {
    throw serviceError("The package service is not available. Please try again later.", 503);
  }
  if (response.status === 404) throw serviceError("The package is not found", 404);
  if (!response.ok) throw serviceError("Not enough seats left for this package", 409);
  return response.json();
}

// Takes seats (change < 0) or gives seats back (change > 0)
async function changeSeats(packageID, change) {
  const pkg = await getPackage(packageID);
  if (!pkg) throw serviceError("The package is not found", 404);
  const newSeatsLeft = Number(pkg.seatsLeft) + change;
  if (newSeatsLeft < 0) throw serviceError(`Only ${pkg.seatsLeft} seats are left for this package`, 409);
  // Never give back more seats than the package has
  return setSeatsLeft(packageID, Math.min(newSeatsLeft, Number(pkg.totalSeats)));
}

module.exports = { getPackage, changeSeats };
