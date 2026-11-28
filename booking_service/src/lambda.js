// Runs the SAME Express app on AWS Lambda (same idea as Lab 7).
// serverless-http turns the API Gateway event into an Express request, and the answer back.
const serverless = require("serverless-http");
const app = require("./app");

module.exports.handler = serverless(app, {
  // API Gateway gives the body as raw bytes. Turn JSON bodies into a JavaScript object.
  request(req) {
    if (Buffer.isBuffer(req.body)) {
      const text = req.body.toString("utf8");
      try {
        req.body = text ? JSON.parse(text) : {};
      } catch (error) {
        req.body = {};
      }
    }
  }
});
