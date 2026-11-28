#!/usr/bin/env bash
# Copies the Brevo settings from .env into AWS Secrets Manager (Floci).
# The key is never printed on the screen.
# Run from the project folder:  bash review_notification_service/infra/store-secret.sh
export AWS_PROFILE=floci AWS_PAGER="" MSYS_NO_PATHCONV=1
cd "$(dirname "$0")/.." || exit 1

# Read one setting from the .env file
get() { grep -E "^$1=" .env | head -1 | cut -d= -f2- | tr -d '\r'; }

KEY=$(get BREVO_API_KEY)
EMAIL=$(get SENDER_EMAIL)
NAME=$(get SENDER_NAME)

if [ -z "$KEY" ]; then
  echo "BREVO_API_KEY is missing in .env, nothing stored"
  exit 1
fi

SECRET=$(printf '{"BREVO_API_KEY":"%s","SENDER_EMAIL":"%s","SENDER_NAME":"%s"}' "$KEY" "$EMAIL" "$NAME")

# Create the secret the first time, or update it if it already exists
aws secretsmanager create-secret --name tour-booking/brevo --secret-string "$SECRET" > /dev/null 2>&1 \
  || aws secretsmanager put-secret-value --secret-id tour-booking/brevo --secret-string "$SECRET" > /dev/null \
  || { echo "Could not store the secret (is Floci running?)"; exit 1; }

echo "Stored tour-booking/brevo in Secrets Manager (BREVO_API_KEY, SENDER_EMAIL, SENDER_NAME)"