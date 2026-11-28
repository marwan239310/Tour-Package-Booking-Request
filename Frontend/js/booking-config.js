// Booking request service (Karim): the API Gateway URL printed by booking_service/infra/deploy-lambda.sh
// (or http://localhost:3002 when the service runs on your PC with npm start).
// Kept in its own file so the package service's deploy script can rewrite config.js without erasing it.
const BOOKING_API_URL = "http://597d9765c4.execute-api.localhost.floci.io:4566";