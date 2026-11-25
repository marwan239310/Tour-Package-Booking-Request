// The main file: it creates the Express app and starts the server
const express = require("express");
const cors = require("cors");
require("dotenv").config();
const requestRoutes = require("./routes/requestRoutes");
const notificationController = require("./controllers/notificationController");
const secretsService = require("./services/secretsService");

const app = express();

app.use(cors());          // lets the frontend call this service

// SNS delivers its messages here (as text). This route must come BEFORE express.json()
app.post("/internal/sns-notify", express.text({ type: "*/*", limit: "64kb" }), notificationController.handleSnsMessage);

app.use(express.json());  // reads JSON from request bodies

// Health check: shows the service is running
app.get("/", (req, res) => {
  res.json({ message: "The review and notification service is running" });
});

app.use("/requests", requestRoutes);   // every /requests URL goes to the routes

// Start: first load the Brevo key from Secrets Manager, then start listening
async function start() {
  await secretsService.loadSecrets();
  const PORT = process.env.PORT || 3003;
  app.listen(PORT, () => {
    console.log(`The review and notification service is running on port ${PORT}`);
  });
}

start();