// Booking requests: data + business rules, stored in DynamoDB.
//   BookingRequests : one item per request (key: requestID). This service CREATES them;
//                     the review & notification service (Ahmed) moves them through the status flow.
//   StatusHistory   : one item per status change (keys: requestID + changedAt). Shared with Ahmed's service.
const { randomUUID } = require("crypto");
const { PutCommand, GetCommand, UpdateCommand, ScanCommand, QueryCommand } = require("@aws-sdk/lib-dynamodb");
const dynamodb = require("../config/dynamodb");
const packageClient = require("./packageClient");
const { normalizeEmail } = require("./validation");

const REQUESTS_TABLE = "BookingRequests";
const HISTORY_TABLE = "StatusHistory";

// The customer can cancel in these statuses (the same moves the review service allows to "cancelled")
const CUSTOMER_CANCELLABLE = ["pending", "under_review", "confirmed", "awaiting_payment"];
// The number of travelers can only change before staff start reviewing
const EDITABLE = ["pending"];

function httpError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function newRequestID() {
  return "REQ-" + randomUUID().split("-")[0].toUpperCase();
}

async function addHistory(requestID, fromStatus, toStatus, note) {
  await dynamodb.send(
    new PutCommand({
      TableName: HISTORY_TABLE,
      Item: {
        requestID,
        changedAt: new Date().toISOString(),
        fromStatus: fromStatus || null,
        toStatus,
        reason: null,
        note: note || null,
        changedBy: "customer"
      }
    })
  );
}

// Function 1: submit a booking request
// Business rules: the package must exist and be published, and must have enough free seats.
// The seats are reserved right away so two customers cannot get the same seats.
async function createBooking(data) {
  const travelers = Number(data.travelers);
  const pkg = await packageClient.getPackage(data.packageID);
  if (!pkg) throw httpError("The package is not found", 404);
  if (!pkg.isPublished) throw httpError("This package is not open for booking", 409);
  if (Number(pkg.seatsLeft) < travelers) {
    throw httpError(`Only ${pkg.seatsLeft} seats are left for this package`, 409);
  }

  // Reserve the seats in the package service (409 if someone else just took them)
  await packageClient.reserveSeats(pkg.packageID, travelers);

  const now = new Date().toISOString();
  const request = {
    requestID: newRequestID(),
    packageID: pkg.packageID,
    packageTitle: pkg.title,
    customerName: data.customerName.trim(),
    customerEmail: normalizeEmail(data.customerEmail),
    phone: String(data.phone).replace(/[\s-]/g, ""),
    travelers,
    totalPrice: Number(pkg.price) * travelers,
    note: data.note ? data.note.trim() : null,
    status: "pending",
    createdAt: now.slice(0, 10), // YYYY-MM-DD: the review service filters requests by this date
    createdAtTime: now,
    updatedAt: now
  };

  try {
    await dynamodb.send(
      new PutCommand({
        TableName: REQUESTS_TABLE,
        Item: request,
        ConditionExpression: "attribute_not_exists(requestID)"
      })
    );
    await addHistory(request.requestID, null, "pending", "Request submitted");
  } catch (error) {
    // Saving failed: give the seats back so they are not lost
    await packageClient.releaseSeats(pkg.packageID, travelers).catch(() => {});
    throw error;
  }
  return request;
}

// Function 2: view my requests (all requests made with this email), newest first
async function getMyBookings(email, status) {
  const values = { ":email": normalizeEmail(email) };
  const names = {};
  let filter = "customerEmail = :email";
  if (status) {
    filter += " AND #status = :status";
    names["#status"] = "status";
    values[":status"] = status;
  }

  let items = [];
  let lastKey;
  do {
    const result = await dynamodb.send(
      new ScanCommand({
        TableName: REQUESTS_TABLE,
        FilterExpression: filter,
        ExpressionAttributeValues: values,
        ...(status ? { ExpressionAttributeNames: names } : {}),
        ExclusiveStartKey: lastKey
      })
    );
    items = items.concat(result.Items || []);
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);

  return items.sort((a, b) => String(b.createdAtTime || b.createdAt).localeCompare(String(a.createdAtTime || a.createdAt)));
}

// One request with its status history. Only the customer who made it can see it.
async function getMyBooking(requestID, email) {
  const result = await dynamodb.send(new GetCommand({ TableName: REQUESTS_TABLE, Key: { requestID } }));
  const request = result.Item;
  // Same answer for "does not exist" and "not yours", so nobody can guess other people's requests
  if (!request || request.customerEmail !== normalizeEmail(email)) return null;

  const history = await dynamodb.send(
    new QueryCommand({
      TableName: HISTORY_TABLE,
      KeyConditionExpression: "requestID = :id",
      ExpressionAttributeValues: { ":id": requestID },
      ScanIndexForward: true
    })
  );
  return { ...request, history: history.Items || [] };
}

// Function 3: cancel my request
// Business rules: only the owner can cancel, only in a cancellable status, and the seats go back to the package.
// The cancel is saved first. If giving the seats back fails (package service down), the cancel still counts:
// the answer says seatsReleased: false and the problem is logged, instead of showing the customer an error.
async function cancelBooking(requestID, email) {
  const request = await getMyBooking(requestID, email);
  if (!request) throw httpError("Booking request not found", 404);
  if (!CUSTOMER_CANCELLABLE.includes(request.status)) {
    throw httpError(`A request that is ${request.status} cannot be cancelled`, 409);
  }

  const now = new Date().toISOString();
  let updated;
  try {
    const result = await dynamodb.send(
      new UpdateCommand({
        TableName: REQUESTS_TABLE,
        Key: { requestID },
        UpdateExpression: "SET #status = :cancelled, updatedAt = :now",
        // Only if staff did not change the status in the meantime
        ConditionExpression: "#status = :oldStatus",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: { ":cancelled": "cancelled", ":now": now, ":oldStatus": request.status },
        ReturnValues: "ALL_NEW"
      })
    );
    updated = result.Attributes;
  } catch (error) {
    if (error.name === "ConditionalCheckFailedException") {
      throw httpError("This request was just changed by the staff. Please refresh and try again.", 409);
    }
    throw error;
  }

  await addHistory(requestID, request.status, "cancelled", "Cancelled by the customer");

  // Give the reserved seats back
  let seatsReleased = false;
  try {
    await packageClient.releaseSeats(request.packageID, Number(request.travelers));
    seatsReleased = true;
  } catch (error) {
    console.log(`Seats not released for ${requestID} (${request.packageID}):`, error.message);
  }
  return { ...updated, seatsReleased };
}

// Extra function: change the number of travelers while the request is still pending
// Business rules: only pending requests, and the extra seats must be free.
async function changeTravelers(requestID, email, newTravelers) {
  const request = await getMyBooking(requestID, email);
  if (!request) throw httpError("Booking request not found", 404);
  if (!EDITABLE.includes(request.status)) {
    throw httpError("The number of travelers can only be changed while the request is pending", 409);
  }
  const travelers = Number(newTravelers);
  const difference = travelers - Number(request.travelers);
  if (difference === 0) return request;

  // Take extra seats (difference > 0, 409 if not enough) or give seats back (difference < 0)
  if (difference > 0) await packageClient.reserveSeats(request.packageID, difference);
  else await packageClient.releaseSeats(request.packageID, -difference);

  const pricePerPerson = Number(request.totalPrice) / Number(request.travelers);
  try {
    const result = await dynamodb.send(
      new UpdateCommand({
        TableName: REQUESTS_TABLE,
        Key: { requestID },
        UpdateExpression: "SET travelers = :travelers, totalPrice = :total, updatedAt = :now",
        ConditionExpression: "#status = :pending",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: {
          ":travelers": travelers,
          ":total": pricePerPerson * travelers,
          ":now": new Date().toISOString(),
          ":pending": "pending"
        },
        ReturnValues: "ALL_NEW"
      })
    );
    return result.Attributes;
  } catch (error) {
    // Undo the seat change
    const undo = difference > 0
      ? packageClient.releaseSeats(request.packageID, difference)
      : packageClient.reserveSeats(request.packageID, -difference);
    await undo.catch(() => {});
    if (error.name === "ConditionalCheckFailedException") {
      throw httpError("This request was just changed by the staff. Please refresh and try again.", 409);
    }
    throw error;
  }
}

module.exports = {
  CUSTOMER_CANCELLABLE,
  createBooking,
  getMyBookings,
  getMyBooking,
  cancelBooking,
  changeTravelers
};
