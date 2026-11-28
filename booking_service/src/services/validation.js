// Input checks for the booking service. Each function returns an error message, or null if the input is fine.

const MAX_TRAVELERS = 10;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^\+?[0-9]{8,15}$/;

function normalizeEmail(email) {
  return typeof email === "string" ? email.trim().toLowerCase() : "";
}

function checkEmail(email) {
  if (!email) return "Email is required";
  if (!EMAIL_PATTERN.test(normalizeEmail(email))) return "Email is not valid";
  return null;
}

function checkTravelers(travelers) {
  const count = Number(travelers);
  if (travelers === undefined || travelers === null || travelers === "") return "Number of travelers is required";
  if (!Number.isInteger(count) || count < 1 || count > MAX_TRAVELERS) {
    return `Travelers must be a whole number from 1 to ${MAX_TRAVELERS}`;
  }
  return null;
}

// POST /bookings body
function checkNewBooking(body = {}) {
  const { packageID, customerName, customerEmail, phone, travelers } = body;
  if (!packageID || typeof packageID !== "string") return "Please choose a package";
  if (!customerName || typeof customerName !== "string" || customerName.trim().length < 3) {
    return "Full name must be at least 3 characters";
  }
  if (customerName.trim().length > 80) return "Full name must be 80 characters or less";
  const emailError = checkEmail(customerEmail);
  if (emailError) return emailError;
  if (!phone || !PHONE_PATTERN.test(String(phone).replace(/[\s-]/g, ""))) {
    return "Phone number must be 8 to 15 digits";
  }
  if (body.note !== undefined && (typeof body.note !== "string" || body.note.length > 300)) {
    return "The note must be text of 300 characters or less";
  }
  return checkTravelers(travelers);
}

module.exports = {
  MAX_TRAVELERS,
  normalizeEmail,
  checkEmail,
  checkTravelers,
  checkNewBooking
};
