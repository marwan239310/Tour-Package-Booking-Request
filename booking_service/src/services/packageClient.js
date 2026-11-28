// Talks to the package service (Marwan) over HTTP.
// The booking service never writes to the Packages table directly: it asks the package service.
// Seats are taken and given back with the package service's /reserve and /release endpoints.
// They change the number inside DynamoDB in one step (with a condition), so two customers
// booking at the same moment can never both get the last seats.

const PACKAGE_SERVICE_URL = () => (process.env.PACKAGE_SERVICE_URL || "http://localhost:3001").replace(/\/$/, "");

function serviceError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

async function callPackageService(path, options) {
  try {
    return await fetch(`${PACKAGE_SERVICE_URL()}${path}`, options);
  } catch (error) {
    throw serviceError("The package service is not available. Please try again later.", 503);
  }
}

// Returns the package, or null if it does not exist
async function getPackage(packageID) {
  const response = await callPackageService(`/packages/${encodeURIComponent(packageID)}`);
  if (response.status === 404) return null;
  if (!response.ok) throw serviceError("The package service is not available. Please try again later.", 503);
  return response.json();
}

// PATCH /packages/:id/reserve or /release with { travelers }
async function moveSeats(action, packageID, travelers) {
  const response = await callPackageService(`/packages/${encodeURIComponent(packageID)}/${action}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ travelers })
  });
  if (response.ok) return response.json();
  if (response.status === 404) throw serviceError("The package is not found", 404);
  if (response.status === 409) {
    throw serviceError(
      action === "reserve" ? "Not enough free seats left for this package" : "These seats could not be given back",
      409
    );
  }
  throw serviceError("The package service is not available. Please try again later.", 503);
}

// Takes seats for a booking (409 if there are not enough free seats)
function reserveSeats(packageID, travelers) {
  return moveSeats("reserve", packageID, travelers);
}

// Gives seats back to the package (cancel, fewer travelers, or undo)
function releaseSeats(packageID, travelers) {
  return moveSeats("release", packageID, travelers);
}

module.exports = { getPackage, reserveSeats, releaseSeats };
