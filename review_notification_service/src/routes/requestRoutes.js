const express = require("express");
const router = express.Router();
const requestController = require("../controllers/requestController");

// Function 1: filter and list requests
router.get("/", requestController.listRequests);

// Function 2: update the status of a request (and save it in the history)
router.patch("/:requestID/status", requestController.updateRequestStatus);

// Status history of one request
router.get("/:requestID/history", requestController.getRequestHistory);

module.exports = router;