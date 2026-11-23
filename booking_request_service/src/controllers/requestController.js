const requestService = require("../services/requestService");

// GET /requests?status=&packageID=&date=
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

module.exports = {
  listRequests
};