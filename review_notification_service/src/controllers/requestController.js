const requestService = require("../services/requestService");
const snsService = require("../services/snsService");
const packageClient = require("../services/packageClient");

// When staff move a request to one of these, its reserved seats go back to the package
const RELEASE_SEATS_STATUSES = ["rejected", "cancelled"];

// Function 1 - GET /requests?status=&packageID=&date=
async function listRequests(req, res) {
  const { status, packageID, date } = req.query;

  // Reject a status that does not exist
  if (status && !requestService.STATUSES.includes(status)) {
    return res.status(400).json({
      message: `Invalid status. Allowed: ${requestService.STATUSES.join(", ")}`
    });
  }

  // Reject a date that is not in the form YYYY-MM-DD
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ message: "Date must be in the format YYYY-MM-DD" });
  }

  try {
    const requests = await requestService.getRequests({ status, packageID, date });
    res.status(200).json(requests);
  } catch (error) {
    console.log("Could not read requests:", error.message);
    res.status(500).json({ message: "Could not load the booking requests" });
  }
}

// Function 2 - PATCH /requests/:requestID/status
// Body: { "status": "...", "reason": "...", "note": "..." }
// Function 3 - after the status changes, publish it to SNS (SNS then triggers the email)
async function updateRequestStatus(req, res) {
  const { requestID } = req.params;
  const { status, reason, note } = req.body || {};

  // 1. The new status is required and must exist
  if (!status) {
    return res.status(400).json({ message: "The new status is required" });
  }
  if (!requestService.STATUSES.includes(status)) {
    return res.status(400).json({
      message: `Invalid status. Allowed: ${requestService.STATUSES.join(", ")}`
    });
  }

  // 2. Rejecting needs a reason (text of at least 5 characters)
  if (status === "rejected" && (typeof reason !== "string" || reason.trim().length < 5)) {
    return res.status(400).json({
      message: "A reason of at least 5 characters is required to reject a request"
    });
  }

  // 3. The staff note is optional, but must be text and not too long
  if (note !== undefined && (typeof note !== "string" || note.length > 300)) {
    return res.status(400).json({ message: "The staff note must be text of 300 characters or less" });
  }

  try {
    const updated = await requestService.updateStatus(
      requestID,
      status,
      typeof reason === "string" ? reason.trim() : undefined,
      note ? note.trim() : undefined
    );
    if (!updated) {
      return res.status(404).json({ message: "Booking request not found" });
    }

    // Seats: the customer's seats were reserved when the request was submitted (Karim's service).
    // If staff reject or cancel it, give the seats back to the package (Marwan's service).
    // If that fails, the status change is still saved and the answer shows seatsReleased: false.
    let seatsReleased = null;
    if (RELEASE_SEATS_STATUSES.includes(updated.status)) {
      try {
        seatsReleased = await packageClient.releaseSeats(updated.packageID, updated.travelers);
      } catch (seatsError) {
        console.log("Seats not released:", seatsError.message);
        seatsReleased = false;
      }
    }

    // Function 3: announce the change on SNS. If it fails, the status change is still saved.
    let notificationPublished = false;
    try {
      await snsService.publishStatusChange(updated);
      notificationPublished = true;
    } catch (snsError) {
      console.log("SNS publish failed:", snsError.message);
    }

    res.status(200).json({ ...updated, seatsReleased, notificationPublished });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    console.log("Could not update the status:", error.message);
    res.status(500).json({ message: "Could not update the booking request" });
  }
}

// GET /requests/:requestID/history
async function getRequestHistory(req, res) {
  const { requestID } = req.params;
  try {
    const request = await requestService.getRequestByID(requestID);
    if (!request) {
      return res.status(404).json({ message: "Booking request not found" });
    }
    const history = await requestService.getHistory(requestID);
    res.status(200).json(history);
  } catch (error) {
    console.log("Could not read the history:", error.message);
    res.status(500).json({ message: "Could not load the status history" });
  }
}

// Extra - GET /requests/count : number of requests in each status
async function countRequests(req, res) {
  try {
    const counts = await requestService.countByStatus();
    res.status(200).json(counts);
  } catch (error) {
    console.log("Could not count requests:", error.message);
    res.status(500).json({ message: "Could not count the booking requests" });
  }
}

module.exports = {
  listRequests,
  updateRequestStatus,
  getRequestHistory,
  countRequests
};