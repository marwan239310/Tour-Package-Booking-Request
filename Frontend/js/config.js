// Written by package_service/infra/deploy-lambda.sh. Safe to edit by hand.
// Package Service API on Floci (API Gateway -> Lambda -> DynamoDB)
// The team login settings are in auth-config.js (written by infra/cognito/setup-cognito.sh).
const API_BASE_URL = "http://localhost:4566/restapis/packages-api/dev/_user_request_";