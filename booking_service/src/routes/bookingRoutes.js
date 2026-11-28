const express = require("express");
const router = express.Router();
const bookingController = require("../controllers/bookingController");

// Function 1: submit a booking request
router.post("/", bookingController.createBooking);

// Function 2: view my requests (by email), and one request with its history
router.get("/", bookingController.getMyBookings);
router.get("/:requestID", bookingController.getMyBooking);

// Function 3: cancel my request
router.patch("/:requestID/cancel", bookingController.cancelBooking);

// Extra: change the number of travelers while pending
router.patch("/:requestID/travelers", bookingController.changeTravelers);

module.exports = router;
