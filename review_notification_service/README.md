# Review & Notification Service (Ahmed Abobakr)

Part of the **Tour Package Booking Request** app (Group 5, Cloud Computing).
Staff use this service to **review booking requests**, **change their status**, and **notify customers by email**.

## Functions

| # | Function | Endpoint |
|---|---|---|
| 1 | Filter and list booking requests (by status, package, date) | `GET /requests?status=&packageID=&date=` |
| 2 | Update a request's status (allowed flow only, reject reason, staff note, saved in history) | `PATCH /requests/{requestID}/status` |
| 3 | Notify the customer by email when the status changes (SNS + Brevo) | automatic, via `POST /internal/sns-notify` |
| + | Status history of one request | `GET /requests/{requestID}/history` |
| + | Number of requests in each status | `GET /requests/count` |
| + | Health check (shows `runtime: lambda` or `pc`) | `GET /` |

### Status flow (business rules)

```
pending -> under_review -> confirmed -> awaiting_payment -> accepted
   |            |              |               |
   +-> rejected / cancelled (at any of these steps)
```
- `accepted`, `rejected` and `cancelled` are final.
- Rejecting needs a **reason** (at least 5 characters). A **staff note** is optional (max 300 characters).
- If two staff change the same request at the same time, the second gets **409** ("changed by someone else").

### API examples

**PATCH /requests/REQ-1/status**
```json
{ "status": "rejected", "reason": "The package is fully booked", "note": "Called the customer" }
```

| Result | Code |
|---|---|
| Status changed (and notification published) | 200 |
| Missing or unknown status, missing reject reason, note too long | 400 |
| Request not found | 404 |
| Move not allowed by the status flow, or changed by someone else | 409 |
| Database problem | 500 |

**GET /requests/count**
```json
{ "total": 4, "byStatus": { "pending": 0, "under_review": 0, "confirmed": 2, "awaiting_payment": 1, "accepted": 0, "rejected": 1, "cancelled": 0 } }
```

## Architecture

```
Browser / frontend --> API Gateway --> Lambda (this service) --> DynamoDB (BookingRequests, StatusHistory)
                                            |
                                            +--> SNS topic --> API Gateway --> Lambda /internal/sns-notify --> Brevo --> customer email
                                            (Brevo key read from Secrets Manager; logs + AUDIT lines in CloudWatch)
```

## AWS services (deployed on Floci)

| AWS service | Resource | Job |
|---|---|---|
| Lambda | `review-notification-service` | Runs the Express app (`src/lambda.js`, serverless-http) |
| API Gateway (HTTP API) | `review-notification-api` | Web address + 8 allowed routes |
| DynamoDB | `BookingRequests`, `StatusHistory` | Requests (key `requestID`) and history (keys `requestID` + `changedAt`) |
| SNS | `booking-status-topic` | Carries the "status changed" event to the email sender |
| Secrets Manager | `tour-booking/brevo` | Brevo API key (never in code or on GitHub) |
| IAM | `review-notification-service-role` | Least privilege: only these tables, this topic, this secret, its own logs |
| CloudWatch Logs | `/aws/lambda/review-notification-service` | Logs + one `AUDIT` line per status change |

External API: **Brevo** (sends the real emails).

## Setup and deploy (Git Bash, Docker Desktop running)

From the project folder, start Floci:
```
docker compose -f infra/floci/docker-compose.yml up -d
```
Then in `review_notification_service`:
```
npm install
cp .env.example .env              # then put your own values in .env
bash infra/setup-aws.sh           # tables, 4 sample requests, SNS topic
bash infra/store-secret.sh        # copies the Brevo settings from .env into Secrets Manager
bash infra/deploy-lambda.sh       # IAM role, Lambda, API Gateway, permission, SNS subscription
```
The last script prints the API address, for example `http://<api-id>.execute-api.localhost.floci.io:4566`.

## Run on your PC (optional)

```
npm start          # http://localhost:3003
```

## Test

```
API_URL=http://<api-id>.execute-api.localhost.floci.io:4566
curl $API_URL/requests?status=confirmed
curl -X PATCH $API_URL/requests/REQ-1/status -H "Content-Type: application/json" -d '{"status":"under_review","note":"Checking seats"}'
curl $API_URL/requests/REQ-1/history
aws logs filter-log-events --log-group-name /aws/lambda/review-notification-service --filter-pattern AUDIT --query "events[].message" --output text
```

## Notes

- `TEST_EMAIL_OVERRIDE` (testing only): when set, every email goes to that address instead of the customer, because the sample customers have fake emails. Remove it to email real customers.
- `.env`, `lambda.zip` and test outputs are never committed (see `.gitignore`).

## Files

```
src/app.js                          Express app (all routes)
src/server.js                       runs it on your PC (npm start)
src/lambda.js                       runs it on AWS Lambda
src/routes/requestRoutes.js         URLs -> controller
src/controllers/requestController.js        validation + answers (functions 1, 2, count, history)
src/controllers/notificationController.js   receives SNS messages -> email (function 3)
src/services/requestService.js      DynamoDB logic, status rules, history, audit log
src/services/snsService.js          publish to SNS / confirm subscription
src/services/notificationService.js Brevo email
src/services/secretsService.js      loads the Brevo key from Secrets Manager
src/config/dynamodb.js              DynamoDB connection
infra/                              setup, secret and deploy scripts + IAM policies
scripts/zip-lambda.js               builds lambda.zip (from Lab 7)
```