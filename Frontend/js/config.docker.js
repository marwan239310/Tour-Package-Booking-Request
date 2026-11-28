// Used by the Docker image (Frontend/Dockerfile) with the local Express container
const API_BASE_URL = "http://localhost:3001";

// Team staff login (Cognito on Floci)
const COGNITO_ENDPOINT = "http://localhost:4566/";
const COGNITO_CLIENT_ID = "";
// localStorage key where the team login keeps the staff ID token
const AUTH_TOKEN_STORAGE_KEY = "staffIdToken";
