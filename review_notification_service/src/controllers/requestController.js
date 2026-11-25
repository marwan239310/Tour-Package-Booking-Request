const requestService = require("../services/requestService");
const notificationService = require("../services/notificationService");

// Function 1 - GET /requests?status=&packageID=&date=
function listRequests(req, res) {
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

  const requests = requestService.getRequests({ status, packageID, date });
  res.status(200).json(requests);
}

// Function 2 - PATCH /requests/:requestID/status
// Body: { "status": "...", "reason": "...", "note": "..." }
// Function 3 - after the status changes, email the customer
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
    const updated = requestService.updateStatus(
      requestID,
      status,
      typeof reason === "string" ? reason.trim() : undefined,
      note ? note.trim() : undefined
    );
    if (!updated) {
      return res.status(404).json({ message: "Booking request not found" });
    }

    // Function 3: send the email. If it fails, the status change is still saved.
    let emailSent = false;
    try {
      emailSent = await notificationService.sendStatusEmail(updated);
    } catch (emailError) {
      console.log("Email not sent:", emailError.message);
    }

    res.status(200).json({ ...updated, emailSent });
  } catch (error) {
    res.status(error.statusCode || 500).json({ message: error.message });
  }
}

// GET /requests/:requestID/history
function getRequestHistory(req, res) {
  const { requestID } = req.params;
  if (!requestService.getRequestByID(requestID)) {
    return res.status(404).json({ message: "Booking request not found" });
  }
  res.status(200).json(requestService.getHistory(requestID));
}

module.exports = {
  listRequests,
  updateRequestStatus,
  getRequestHistory
};