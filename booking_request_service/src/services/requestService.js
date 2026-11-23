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

// Sample booking requests (in the real system Karim's service creates these)
let requests = [
  { requestID: "REQ-1", packageID: "PKG-1", customerName: "Sara Ali",    customerEmail: "sara@example.com",  travelers: 2, status: "pending",      createdAt: "2026-11-20" },
  { requestID: "REQ-2", packageID: "PKG-1", customerName: "Omar Hassan", customerEmail: "omar@example.com",  travelers: 4, status: "under_review", createdAt: "2026-11-21" },
  { requestID: "REQ-3", packageID: "PKG-2", customerName: "Mona Adel",   customerEmail: "mona@example.com",  travelers: 1, status: "confirmed",    createdAt: "2026-11-21" },
  { requestID: "REQ-4", packageID: "PKG-3", customerName: "Youssef Nabil", customerEmail: "youssef@example.com", travelers: 3, status: "rejected", createdAt: "2026-11-22" }
];

// Function 1: return the requests that match the filters (all of them if no filters)
function getRequests(filters = {}) {
  return requests.filter((request) => {
    if (filters.status && request.status !== filters.status) return false;
    if (filters.packageID && request.packageID !== filters.packageID) return false;
    if (filters.date && request.createdAt !== filters.date) return false;
    return true;
  });
}

module.exports = {
  STATUSES,
  getRequests
};