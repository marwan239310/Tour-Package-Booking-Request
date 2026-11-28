// SNS: when a customer cancels, publish the change to "booking-status-topic".
// The review & notification service (Ahmed) is subscribed to this topic and emails the customer.
const { SNSClient, PublishCommand } = require("@aws-sdk/client-sns");

const sns = new SNSClient({
  region: process.env.AWS_REGION || "us-east-1",
  endpoint: process.env.AWS_ENDPOINT || "http://localhost:4566",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || "test",
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "test"
  }
});

// Same message shape as the review service: only the ID and status (no personal data)
async function publishStatusChange(request) {
  if (!process.env.SNS_TOPIC_ARN) return null;
  const result = await sns.send(
    new PublishCommand({
      TopicArn: process.env.SNS_TOPIC_ARN,
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

module.exports = { publishStatusChange };
