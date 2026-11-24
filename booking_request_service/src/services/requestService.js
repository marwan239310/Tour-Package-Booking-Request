// Booking requests data + logic (sample data for now, DynamoDB later)

// The statuses a request can have
const STATUSES = [
  "pending",
  "under_review",
  "confirmed",
  "awaiting_payment",
  "accepted",
  "rejected",
  "cancelled"
];

// Function 2: the allowed status flow (where each status is allowed to go next)
// accepted, rejected and cancelled are final: nothing can come after them
const ALLOWED_NEXT = {
  pending:          ["under_review", "rejected", "cancelled"],
  under_review:     ["confirmed", "rejected", "cancelled"],
  confirmed:        ["awaiting_payment", "cancelled"],
  awaiting_payment: ["accepted", "cancelled"],
  accepted:         [],
  rejected:         [],
  cancelled:        []
};

// Sample booking requests (in the real system Karim's service creates these)
let requests = [
  { requestID: "REQ-1", packageID: "PKG-1", customerName: "Sara Ali",    customerEmail: "sara@example.com",  travelers: 2, status: "pending",      createdAt: "2026-11-20" },
  { requestID: "REQ-2", packageID: "PKG-1", customerName: "Omar Hassan", customerEmail: "omar@example.com",  travelers: 4, status: "under_review", createdAt: "2026-11-21" },
  { requestID: "REQ-3", packageID: "PKG-2", customerName: "Mona Adel",   customerEmail: "mona@example.com",  travelers: 1, status: "confirmed",    createdAt: "2026-11-21" },
  { requestID: "REQ-4", packageID: "PKG-3", customerName: "Youssef Nabil", customerEmail: "youssef@example.com", travelers: 3, status: "rejected", createdAt: "2026-11-22" }
];

// Function 2: every status change is saved here (the status history)
let history = [];

// Function 1: return the requests that match the filters (all of them if no filters)
function getRequests(filters = {}) {
  return requests.filter((request) => {
    if (filters.status && request.status !== filters.status) return false;
    if (filters.packageID && request.packageID !== filters.packageID) return false;
    if (filters.date && request.createdAt !== filters.date) return false;
    return true;
  });
}

// Find one request by its ID
function getRequestByID(requestID) {
  return requests.find((request) => request.requestID === requestID);
}

// Function 2: change the status of a request and save the change in the history
function updateStatus(requestID, newStatus, reason, note) {
  const request = getRequestByID(requestID);
  if (!request) return null;

  const oldStatus = request.status;

  // Only allow the moves listed in ALLOWED_NEXT
  if (!ALLOWED_NEXT[oldStatus].includes(newStatus)) {
    const error = new Error(
      `Cannot change status from ${oldStatus} to ${newStatus}. Allowed: ${ALLOWED_NEXT[oldStatus].join(", ") || "none (final status)"}`
    );
    error.statusCode = 409;   // 409 Conflict: the request is not in the right state
    throw error;
  }

  request.status = newStatus;
  if (reason) request.rejectionReason = reason;
  if (note) request.staffNote = note;

  // Save the change in the status history
  const entry = {
    requestID: requestID,
    fromStatus: oldStatus,
    toStatus: newStatus,
    reason: reason || null,
    note: note || null,
    changedAt: new Date().toISOString()
  };
  history.push(entry);

  return request;
}

// Return the status history of one request (oldest first)
function getHistory(requestID) {
  return history.filter((entry) => entry.requestID === requestID);
}

module.exports = {
  STATUSES,
  getRequests,
  getRequestByID,
  updateStatus,
  getHistory
};