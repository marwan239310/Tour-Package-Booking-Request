const express = require("express");
const router = express.Router();
const requestController = require("../controllers/requestController");

// Function 1: filter and list requests
router.get("/", requestController.listRequests);

module.exports = router;