// Receives the messages that SNS delivers to POST /internal/sns-notify
// and turns each one into a real email for the customer (Brevo).
const snsService = require("../services/snsService");
const requestService = require("../services/requestService");
const notificationService = require("../services/notificationService");

async function handleSnsMessage(req, res) {
  // SNS sends its body as text, so we read it as text and turn it into an object
  let payload;
  try {
    payload = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  } catch (error) {
    return res.status(400).send("Invalid SNS message");
  }
  if (!payload || !payload.Type) {
    return res.status(400).send("Invalid SNS message");
  }

  // Security: only accept messages that come from OUR topic
  if (payload.TopicArn !== snsService.TOPIC_ARN) {
    console.log(`SNS: rejected a message from another topic (${payload.TopicArn})`);
    return res.status(403).send("Unknown topic");
  }

  // 1. First message after subscribing: SNS asks us to confirm
  if (payload.Type === "SubscriptionConfirmation") {
    try {
      await snsService.confirmSubscription(payload.TopicArn, payload.Token);
      return res.status(200).send("Subscription confirmed");
    } catch (error) {
      console.log("SNS: could not confirm the subscription:", error.message);
      return res.status(500).send("Could not confirm");
    }
  }

  // 2. A normal message: "this request now has this status" -> email the customer
  if (payload.Type === "Notification") {
    let message;
    try {
      message = JSON.parse(payload.Message);
    } catch (error) {
      return res.status(400).send("Invalid message content");
    }

    // NEW: read the request from DynamoDB (await = wait for the database)
    let request;
    try {
      request = await requestService.getRequestByID(message.requestID);
    } catch (error) {
      console.log("SNS: could not read the request:", error.message);
      return res.status(500).send("Could not read the request");
    }
    if (!request) {
      console.log(`SNS: request ${message.requestID} not found, no email sent`);
      return res.status(200).send("Request not found");
    }

    try {
      // Use the status from the message (the status at the moment it changed)
      await notificationService.sendStatusEmail({ ...request, status: message.status });
    } catch (error) {
      console.log("Email not sent:", error.message);
    }
    return res.status(200).send("Notification handled");
  }

  return res.status(200).send("Ignored");
}

module.exports = {
  handleSnsMessage
};