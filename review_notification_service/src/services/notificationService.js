// Function 3: send an email to the customer when the status of their request changes
// Uses the Brevo email API (external API). The key is read from the .env file.

const BREVO_URL = "https://api.brevo.com/v3/smtp/email";

// Friendly text for each status
const STATUS_TEXT = {
  pending: "Pending",
  under_review: "Under review",
  confirmed: "Confirmed",
  awaiting_payment: "Awaiting payment",
  accepted: "Accepted",
  rejected: "Rejected",
  cancelled: "Cancelled"
};

// Make text safe to put inside the email's HTML (stops HTML/script injection)
function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function sendStatusEmail(request) {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    console.log("Email not sent: BREVO_API_KEY is missing in .env");
    return false;
  }

  // While testing, send every email to your own inbox instead of the sample customers
  const toEmail = process.env.TEST_EMAIL_OVERRIDE || request.customerEmail;
  const statusText = STATUS_TEXT[request.status] || request.status;

  let html = `<p>Dear ${escapeHtml(request.customerName)},</p>
<p>The status of your booking request <strong>${escapeHtml(request.requestID)}</strong> is now: <strong>${statusText}</strong>.</p>`;
  if (request.status === "rejected" && request.rejectionReason) {
    html += `<p>Reason: ${escapeHtml(request.rejectionReason)}</p>`;
  }
  html += `<p>Thank you,<br>${escapeHtml(process.env.SENDER_NAME || "Tour Booking")}</p>`;

  const response = await fetch(BREVO_URL, {
    method: "POST",
    headers: {
      "api-key": apiKey,
      "Content-Type": "application/json",
      "Accept": "application/json"
    },
    body: JSON.stringify({
      sender: { name: process.env.SENDER_NAME || "Tour Booking", email: process.env.SENDER_EMAIL },
      to: [{ email: toEmail, name: request.customerName }],
      subject: `Booking ${request.requestID}: ${statusText}`,
      htmlContent: html
    })
  });

  if (!response.ok) {
    const details = await response.text();
    console.log(`Email not sent (Brevo answered ${response.status}): ${details}`);
    return false;
  }

  console.log(`Email sent to ${toEmail} for ${request.requestID} (${statusText})`);
  return true;
}

module.exports = {
  sendStatusEmail
};