// The Express app: all the routes. Used by BOTH server.js (your laptop) and lambda.js (AWS Lambda)
const express = require("express");
const cors = require("cors");
const requestRoutes = require("./routes/requestRoutes");
const notificationController = require("./controllers/notificationController");
const { requireStaff } = require("./middleware/auth");

const app = express();

app.use(cors());          // lets the frontend call this service

// SNS delivers its messages here (as text). This route must come BEFORE express.json()
app.post("/internal/sns-notify", express.text({ type: "*/*", limit: "64kb" }), notificationController.handleSnsMessage);

app.use(express.json());  // reads JSON from request bodies

// Health check: shows the service is running, and where (Lambda or your PC)
app.get("/", (req, res) => {
  const runtime = process.env.AWS_LAMBDA_FUNCTION_NAME ? "lambda" : "pc";
  res.json({ message: "The review and notification service is running", runtime });
});

// Every /requests URL is for staff only: the login check runs first, then the routes
app.use("/requests", requireStaff, requestRoutes);

module.exports = app;