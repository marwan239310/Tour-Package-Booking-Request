// Secrets Manager: load the Brevo email settings when the service starts.
// The key is stored in AWS (Floci), not in the code or on GitHub.
const { SecretsManagerClient, GetSecretValueCommand } = require("@aws-sdk/client-secrets-manager");

const client = new SecretsManagerClient({
  region: process.env.AWS_REGION || "us-east-1",
  endpoint: process.env.AWS_ENDPOINT || "http://localhost:4566",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || "test",
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "test"
  }
});

const SECRET_ID = process.env.SECRET_ID || "tour-booking/brevo";

// Reads the secret (a small JSON object) and puts its values in process.env,
// so the rest of the code (notificationService.js) can use them as before.
async function loadSecrets() {
  try {
    const result = await client.send(new GetSecretValueCommand({ SecretId: SECRET_ID }));
    const values = JSON.parse(result.SecretString);
    for (const [name, value] of Object.entries(values)) {
      process.env[name] = value;
    }
    // Only print the NAMES of the settings, never the values
    console.log(`Secrets Manager: loaded ${Object.keys(values).join(", ")} from ${SECRET_ID}`);
  } catch (error) {
    // The service still starts, but emails will not be sent until the secret exists
    console.log(`Secrets Manager: could not load ${SECRET_ID} (${error.name}). Emails will not be sent.`);
  }
}

module.exports = {
  loadSecrets
};
