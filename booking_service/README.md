# Booking Request Service (Karim Abo Elnaser)

Part of the **Tour Package Booking Request** app (Group 5, Cloud Computing).
Customers use this service to **send booking requests**, **follow their requests**, **change the number of travelers** and **cancel**.

## Functions

| # | Function | Endpoint |
|---|---|---|
| 1 | Submit a booking request (checks the package is published and has enough free seats, then reserves the seats) | `POST /bookings` |
| 2 | View my requests (by email, optional status filter) | `GET /bookings?email=&status=` |
| 2 | View one request with its status history | `GET /bookings/{requestID}?email=` |
| 3 | Cancel my request (only in a cancellable status, seats go back to the package, customer is emailed via SNS) | `PATCH /bookings/{requestID}/cancel` |
| + | Change the number of travelers while the request is pending (extra seats must be free) | `PATCH /bookings/{requestID}/travelers` |
| + | Health check (shows `runtime: lambda` or `pc`) | `GET /` |

### Business rules

- Travelers: whole number from 1 to 10, and not more than the package's free seats.
- Only **published** packages can be booked (409 otherwise).
- Seats are **reserved when the request is sent**, so two customers cannot get the same seats (no overbooking).
- Cancel is allowed while the request is `pending`, `under_review`, `confirmed` or `awaiting_payment` (same flow as the review service). The seats are given back.
- Travelers can only change while the request is `pending`.
- Only the customer who made a request (same email) can see, change or cancel it. Other emails get 404.
- If staff change the status at the same moment, the customer gets 409 ("just changed by the staff").

### API examples

**POST /bookings**
```json
{ "packageID": "PKG-1", "customerName": "Karim Test", "customerEmail": "karim@example.com",
  "phone": "01012345678", "travelers": 2, "note": "Two adults" }
```

| Result | Code |
|---|---|
| Request saved as `pending` (returns `requestID`, `totalPrice`) | 201 |
| Missing or invalid name, email, phone, travelers or note | 400 |
| Package not found | 404 |
| Package not published, or not enough free seats | 409 |
| Package service not reachable | 503 |
| Database problem | 500 |

**PATCH /bookings/REQ-1A2B3C4D/cancel**
```json
{ "email": "karim@example.com" }
```
200 cancelled, 400 bad email, 404 not found / not yours, 409 status cannot be cancelled.

**PATCH /bookings/REQ-1A2B3C4D/travelers**
```json
{ "email": "karim@example.com", "travelers": 3 }
```
200 updated, 400 bad input, 404 not found / not yours, 409 not pending or not enough seats.

## How it connects to the other services

```
Browser (booking.html, my-bookings.html)
   |
   v
API Gateway (booking-request-api) --> Lambda (booking-request-service)
                                         |-- HTTP --> Package service (Marwan): read package, reserve/return seats
                                         |-- DynamoDB BookingRequests (creates requests; Ahmed's service reviews them)
                                         |-- DynamoDB StatusHistory   (shared timeline with Ahmed's service)
                                         |-- SNS booking-status-topic (cancel -> Ahmed's service emails the customer via Brevo)
                                         '-- CloudWatch Logs
```

## AWS services (on Floci)

| AWS service | Resource | Job |
|---|---|---|
| Lambda | `booking-request-service` | Runs the Express app (`src/lambda.js`, serverless-http) |
| API Gateway (HTTP API) | `booking-request-api` | Web address + routes |
| DynamoDB | `BookingRequests`, `StatusHistory` | Booking requests (key `requestID`) and their history |
| SNS | `booking-status-topic` | Announces cancellations so the customer gets an email |
| IAM | `booking-request-service-role` | Least privilege: only these tables, this topic, its own logs |
| CloudWatch Logs | `/aws/lambda/booking-request-service` | Logs |

## Setup and deploy (Git Bash, Docker Desktop running)

From the project folder, start Floci (if it is not running):
```
docker compose -f infra/floci/docker-compose.yml up -d
```
Then in `booking_service`:
```
npm install
cp .env.example .env
bash infra/setup-aws.sh        # tables + SNS topic (skips what already exists)
bash infra/deploy-lambda.sh    # IAM role, Lambda, API Gateway, permission
```
The last script prints the API address, for example `http://<api-id>.execute-api.localhost.floci.io:4566`.
Put it in `Frontend/js/config.js` as `BOOKING_API_URL`.

The package service must be running where the Lambda can reach it (default `http://host.docker.internal:3001`, i.e. `docker compose up` in the project folder).

## Run on your PC (optional)

```
npm start          # http://localhost:3002
```

## Test

```
npm test           # 15 automated tests (DynamoDB and the package service are faked)
```

Manual test on the deployed API:
```
API_URL=http://<api-id>.execute-api.localhost.floci.io:4566
curl -X POST $API_URL/bookings -H "Content-Type: application/json" \
  -d '{"packageID":"<a published package id>","customerName":"Karim Test","customerEmail":"karim@example.com","phone":"01012345678","travelers":2}'
curl "$API_URL/bookings?email=karim@example.com"
curl -X PATCH $API_URL/bookings/<requestID>/travelers -H "Content-Type: application/json" -d '{"email":"karim@example.com","travelers":3}'
curl -X PATCH $API_URL/bookings/<requestID>/cancel -H "Content-Type: application/json" -d '{"email":"karim@example.com"}'
```

## Files

```
src/app.js                          Express app (all routes)
src/server.js                       runs it on your PC (npm start)
src/lambda.js                       runs it on AWS Lambda
src/routes/bookingRoutes.js         URLs -> controller
src/controllers/bookingController.js  input checks + answers (status codes)
src/services/bookingService.js      DynamoDB logic and business rules
src/services/packageClient.js       calls the package service (read package, reserve / return seats)
src/services/snsService.js          publishes cancellations to SNS
src/services/validation.js          input validation rules
src/config/dynamodb.js              DynamoDB connection
infra/                              setup + deploy scripts and IAM policies
scripts/zip-lambda.js               builds lambda.zip (from Lab 7)
tests/booking.test.js               automated tests
```
