// SNS: publish a message to the "booking-status-topic" whenever a status changes.
// SNS then delivers the message to everyone subscribed to the topic.
// Same pattern as Lab 8 (AWS SDK v3, connected to Floci).
const { SNSClient, PublishCommand, ConfirmSubscriptionCommand } = require("@aws-sdk/client-sns");

const sns = new SNSClient({
  region: process.env.AWS_REGION || "us-east-1",
  endpoint: process.env.AWS_ENDPOINT || "http://localhost:4566",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || "test",
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "test"
  }
});

const TOPIC_ARN = process.env.SNS_TOPIC_ARN;

// Announce "this request now has this status".
// Only the ID and the status go in the message (no personal data like emails).
async function publishStatusChange(request) {
  const result = await sns.send(
    new PublishCommand({
      TopicArn: TOPIC_ARN,
      Subject: `Booking ${request.requestID}: ${request.status}`,
      Message: JSON.stringify({
        requestID: request.requestID,
        status: request.status,
        changedAt: new Date().toISOString()
      })
    })
  );
  console.log(`SNS: published ${request.requestID} (${request.status}), MessageId ${result.MessageId}`);
  return result.MessageId;
}

// When we subscribe, SNS first sends a "SubscriptionConfirmation".
// We must confirm it, otherwise SNS will not deliver any messages to us.
async function confirmSubscription(topicArn, token) {
  await sns.send(new ConfirmSubscriptionCommand({ TopicArn: topicArn, Token: token }));
  console.log("SNS: subscription confirmed");
}

module.exports = {
  TOPIC_ARN,
  publishStatusChange,
  confirmSubscription
};