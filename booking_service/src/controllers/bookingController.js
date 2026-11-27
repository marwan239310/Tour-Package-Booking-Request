const bookingService = require("../services/bookingService");
const snsService = require("../services/snsService");
const { checkNewBooking, checkEmail, checkTravelers } = require("../services/validation");

const STATUSES = ["pending", "under_review", "confirmed", "awaiting_payment", "accepted", "rejected", "cancelled"];

// Sends the right status code for known errors, and 500 for anything else
function sendError(res, error, fallbackMessage) {
  if (error.statusCode) return res.status(error.statusCode).json({ message: error.message });
  console.log(fallbackMessage + ":", error.message);
  return res.status(500).json({ message: fallbackMessage });
}

// Function 1 - POST /bookings
// Body: { packageID, customerName, customerEmail, phone, travelers, note? }
async function createBooking(req, res) {
  const error = checkNewBooking(req.body);
  if (error) return res.status(400).json({ message: error });

  try {
    const booking = await bookingService.createBooking(req.body);
    res.status(201).json(booking);
  } catch (err) {
    sendError(res, err, "Could not save the booking request");
  }
}

// Function 2 - GET /bookings?email=&status=
async function getMyBookings(req, res) {
  const { email, status } = req.query;
  const error = checkEmail(email);
  if (error) return res.status(400).json({ message: error });
  if (status && !STATUSES.includes(status)) {
    return res.status(400).json({ message: `Invalid status. Allowed: ${STATUSES.join(", ")}` });
  }

  try {
    res.status(200).json(await bookingService.getMyBookings(email, status));
  } catch (err) {
    sendError(res, err, "Could not load your booking requests");
  }
}

// GET /bookings/:requestID?email=  (one request + its status history)
async function getMyBooking(req, res) {
  const error = checkEmail(req.query.email);
  if (error) return res.status(400).json({ message: error });

  try {
    const booking = await bookingService.getMyBooking(req.params.requestID, req.query.email);
    if (!booking) return res.status(404).json({ message: "Booking request not found" });
    res.status(200).json(booking);
  } catch (err) {
    sendError(res, err, "Could not load the booking request");
  }
}

// Function 3 - PATCH /bookings/:requestID/cancel   Body: { email }
async function cancelBooking(req, res) {
  const { email } = req.body || {};
  const error = checkEmail(email);
  if (error) return res.status(400).json({ message: error });

  try {
    const booking = await bookingService.cancelBooking(req.params.requestID, email);
    // Tell the notification service (it emails the customer). The cancel is saved even if this fails.
    let notificationPublished = false;
    try {
      notificationPublished = Boolean(await snsService.publishStatusChange(booking));
    } catch (snsError) {
      console.log("SNS publish failed:", snsError.message);
    }
    res.status(200).json({ ...booking, notificationPublished });
  } catch (err) {
    sendError(res, err, "Could not cancel the booking request");
  }
}

// Extra - PATCH /bookings/:requestID/travelers   Body: { email, travelers }
async function changeTravelers(req, res) {
  const { email, travelers } = req.body || {};
  const error = checkEmail(email) || checkTravelers(travelers);
  if (error) return res.status(400).json({ message: error });

  try {
    const booking = await bookingService.changeTravelers(req.params.requestID, email, travelers);
    res.status(200).json(booking);
  } catch (err) {
    sendError(res, err, "Could not change the number of travelers");
  }
}

module.exports = { createBooking, getMyBookings, getMyBooking, cancelBooking, changeTravelers };
