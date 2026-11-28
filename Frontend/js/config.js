// Written by package_service/infra/deploy-lambda.sh. Safe to edit by hand.
// Package Service API on Floci (API Gateway -> Lambda -> DynamoDB)
const API_BASE_URL = "http://localhost:4566/restapis/packages-api/dev/_user_request_";

// Team staff login (Cognito on Floci)
const COGNITO_ENDPOINT = "http://localhost:4566/";
const COGNITO_CLIENT_ID = "";
// localStorage key where the team login keeps the staff ID token
const AUTH_TOKEN_STORAGE_KEY = "staffIdToken";