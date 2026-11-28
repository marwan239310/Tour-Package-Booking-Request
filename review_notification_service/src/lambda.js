// Runs the SAME Express app on AWS Lambda (same idea as Lab 7).
// serverless-http turns the Lambda event into an Express request, and the answer back.
const serverless = require("serverless-http");
const app = require("./app");
const secretsService = require("./services/secretsService");

const handler = serverless(app, {
  // serverless-http gives the body as raw bytes (a Buffer). Turn it into what our routes expect:
  // a JavaScript object for JSON requests, and text for the SNS messages.
  request(req) {
    if (Buffer.isBuffer(req.body)) {
      const text = req.body.toString("utf8");
      const contentType = req.headers["content-type"] || "";
      if (req.url.startsWith("/internal/sns-notify")) {
        req.body = text;
      } else if (contentType.includes("application/json")) {
        try {
          req.body = text ? JSON.parse(text) : {};
        } catch (error) {
          req.body = {};
        }
      }
    }
  }
});

// Load the Brevo key from Secrets Manager ONCE, when Lambda starts this copy of the function
let secretsLoaded;

module.exports.handler = async (event, context) => {
  if (!secretsLoaded) secretsLoaded = secretsService.loadSecrets();
  await secretsLoaded;
  return handler(event, context);
};