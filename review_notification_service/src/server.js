// Runs the service on YOUR LAPTOP (npm start)
require("dotenv").config();
const app = require("./app");
const secretsService = require("./services/secretsService");

// Start: first load the Brevo key from Secrets Manager, then start listening
async function start() {
  await secretsService.loadSecrets();
  const PORT = process.env.PORT || 3003;
  app.listen(PORT, () => {
    console.log(`The review and notification service is running on port ${PORT}`);
  });
}

start();