// Booking requests data + logic, stored in DynamoDB
//   BookingRequests : one item per request (Karim's service creates them, we update the status)
//   StatusHistory   : one item per status change (key = requestID + changedAt)
const { ScanCommand, GetCommand, UpdateCommand, PutCommand, QueryCommand } = require("@aws-sdk/lib-dynamodb");
const dynamodb = require("../config/dynamodb");

const REQUESTS_TABLE = "BookingRequests";
const HISTORY_TABLE = "StatusHistory";

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

// Function 1: return the requests that match the filters (all of them if no filters)
// The filtering is done by DynamoDB itself (FilterExpression)
async function getRequests(filters = {}) {
  const conditions = [];
  const names = {};
  const values = {};

  if (filters.status) {
    conditions.push("#status = :status");
    names["#status"] = "status";
    values[":status"] = filters.status;
  }
  if (filters.packageID) {
    conditions.push("packageID = :packageID");
    values[":packageID"] = filters.packageID;
  }
  if (filters.date) {
    conditions.push("createdAt = :date");
    values[":date"] = filters.date;
  }

  const params = { TableName: REQUESTS_TABLE };
  if (conditions.length > 0) {
    params.FilterExpression = conditions.join(" AND ");
    params.ExpressionAttributeValues = values;
    if (Object.keys(names).length > 0) params.ExpressionAttributeNames = names;
  }

  // A scan returns at most 1 MB at a time, so keep reading until there are no more pages
  let items = [];
  let lastKey;
  do {
    const result = await dynamodb.send(new ScanCommand({ ...params, ExclusiveStartKey: lastKey }));
    items = items.concat(result.Items || []);
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);

  // Oldest first
  return items.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}

// Find one request by its ID
async function getRequestByID(requestID) {
  const result = await dynamodb.send(
    new GetCommand({ TableName: REQUESTS_TABLE, Key: { requestID } })
  );
  return result.Item || null;
}

// Function 2: change the status of a request and save the change in the history
async function updateStatus(requestID, newStatus, reason, note) {
  const request = await getRequestByID(requestID);
  if (!request) return null;

  const oldStatus = request.status;

  // Only allow the moves listed in ALLOWED_NEXT
  if (!ALLOWED_NEXT[oldStatus] || !ALLOWED_NEXT[oldStatus].includes(newStatus)) {
    const allowed = (ALLOWED_NEXT[oldStatus] || []).join(", ") || "none (final status)";
    const error = new Error(`Cannot change status from ${oldStatus} to ${newStatus}. Allowed: ${allowed}`);
    error.statusCode = 409;   // 409 Conflict: the request is not in the right state
    throw error;
  }

  // Build the update: always the status, plus the reason / note if given
  const sets = ["#status = :newStatus", "updatedAt = :now"];
  const values = {
    ":newStatus": newStatus,
    ":oldStatus": oldStatus,
    ":now": new Date().toISOString()
  };
  if (reason) {
    sets.push("rejectionReason = :reason");
    values[":reason"] = reason;
  }
  if (note) {
    sets.push("staffNote = :note");
    values[":note"] = note;
  }

  let updated;
  try {
    const result = await dynamodb.send(
      new UpdateCommand({
        TableName: REQUESTS_TABLE,
        Key: { requestID },
        UpdateExpression: "SET " + sets.join(", "),
        // Only update if nobody else changed the status in the meantime
        ConditionExpression: "#status = :oldStatus",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: values,
        ReturnValues: "ALL_NEW"
      })
    );
    updated = result.Attributes;
  } catch (error) {
    if (error.name === "ConditionalCheckFailedException") {
      const conflict = new Error("This request was just changed by someone else. Please refresh and try again.");
      conflict.statusCode = 409;
      throw conflict;
    }
    throw error;
  }

  // Save the change in the status history
  await dynamodb.send(
    new PutCommand({
      TableName: HISTORY_TABLE,
      Item: {
        requestID: requestID,
        changedAt: values[":now"],
        fromStatus: oldStatus,
        toStatus: newStatus,
        reason: reason || null,
        note: note || null
      }
    })
  );

    // CloudWatch Logs: one clear AUDIT line for every status change (who / what / when).
  // In Lambda, everything printed with console.log goes to CloudWatch Logs automatically.
  console.log(JSON.stringify({
    type: "AUDIT",
    action: "STATUS_CHANGE",
    requestID: requestID,
    fromStatus: oldStatus,
    toStatus: newStatus,
    reason: reason || null,
    note: note || null,
    changedAt: values[":now"]
  }));
  
  return updated;
}

// Return the status history of one request (oldest first)
// Query (not Scan): DynamoDB goes straight to this request's items using the key
async function getHistory(requestID) {
  const result = await dynamodb.send(
    new QueryCommand({
      TableName: HISTORY_TABLE,
      KeyConditionExpression: "requestID = :id",
      ExpressionAttributeValues: { ":id": requestID },
      ScanIndexForward: true
    })
  );
  return result.Items || [];
}

// Extra: how many requests are in each status (for the staff dashboard)
async function countByStatus() {
  const requests = await getRequests();
  const byStatus = {};
  for (const status of STATUSES) byStatus[status] = 0;   // start every status at 0
  for (const request of requests) {
    if (byStatus[request.status] !== undefined) byStatus[request.status] += 1;
  }
  return { total: requests.length, byStatus };
}

module.exports = {
  STATUSES,
  getRequests,
  getRequestByID,
  updateStatus,
  getHistory,
  countByStatus
};