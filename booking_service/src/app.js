// The Express app with all the routes. Used by server.js (your PC) and lambda.js (AWS Lambda).
const express = require("express");
const cors = require("cors");
const bookingRoutes = require("./routes/bookingRoutes");

const app = express();

app.use(cors());
app.use(express.json());

// Health check: shows the service is running, and where (Lambda or your PC)
app.get("/", (req, res) => {
  const runtime = process.env.AWS_LAMBDA_FUNCTION_NAME ? "lambda" : "pc";
  res.json({ message: "The booking request service is running", runtime });
});

app.use("/bookings", bookingRoutes);

// Unknown URL
app.use((req, res) => res.status(404).json({ message: "Route not found" }));

// Broken JSON in the request body
app.use((err, req, res, next) => {
  if (err.type === "entity.parse.failed") return res.status(400).json({ message: "The request body is not valid JSON" });
  console.log("Unexpected error:", err.message);
  res.status(500).json({ message: "Something went wrong" });
});

module.exports = app;
