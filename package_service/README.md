# Package Service

## 1. Overview

The Package Service is responsible for managing tour packages in the Tour Package Booking Request System.

It provides REST API endpoints to create, retrieve, update, and manage tour packages and their available seats. Creating, editing and publishing packages is limited to staff signed in through the team Cognito login.

The service uses AWS DynamoDB for data storage and FLOCI for local cloud-service emulation.

## 2. Architecture

The deployment architecture is:

**Frontend (S3 website) → FLOCI API Gateway → FLOCI Lambda → DynamoDB**

The Lambda also calls the external **Frankfurter exchange-rate API** to show package prices in other currencies, and checks staff tokens from the team **Cognito** user pool.

Technologies used:

- Node.js
- Express.js
- AWS SDK for JavaScript
- Amazon DynamoDB
- AWS Lambda
- API Gateway
- Amazon S3 (frontend hosting)
- AWS IAM (least-privilege role)
- Amazon CloudWatch Logs (request and audit logs)
- Amazon Cognito (staff login, shared)
- Frankfurter exchange-rate API (external)
- FLOCI
- Docker

## 3. Project Structure

```text
package_service/
│
├── README.md
├── infra/
│   └── deploy-lambda.sh      (builds and deploys everything to Floci)
│
└── src/
    ├── config/
    │   └── dynamodb.js
    │
    ├── controllers/
    │   └── packageController.js
    │
    ├── validation/
    │   └── packageValidation.js  (all input checks)
    │
    ├── tests/
    │   └── package-service.test.js  (npm test)
    │
    ├── middleware/
    │   └── requireStaff.js   (checks the staff Cognito token)
    │
    ├── routes/
    │   └── packageRoutes.js
    │
    ├── services/
    │   ├── packageService.js
    │   └── currencyService.js  (external exchange-rate API)
    │
    ├── scripts/
    │   ├── create-packages-table.js
    │   ├── seed-packages.js
    │   └── zip-lambda.js     (cross-platform Lambda ZIP builder)
    │
    ├── lambda.js
    ├── server.js
    ├── package.json
    └── package-lock.json
```

## 4. Database Configuration

The service uses DynamoDB with a table named:

`Packages`

The table partition key is:

`packageId` (String)

Package attributes include:

- packageId
- title
- destination
- itinerary
- startDate
- endDate
- price
- totalSeats
- seatsLeft
- isPublished

The DynamoDB configuration supports both local FLOCI and other AWS-compatible environments through environment variables.

For local FLOCI development, the DynamoDB endpoint is:

`http://localhost:4566`

For Lambda running inside FLOCI, the endpoint is:

`http://host.docker.internal:4566`

## 5. Prerequisites

Before running the service, make sure you have:

- Node.js and npm installed.
- Docker Desktop installed and running.
- FLOCI running.
- AWS CLI installed.
- The `floci` AWS CLI profile configured.

## 6. Install Dependencies

Open a terminal inside:

`package_service/src`

Run:

```bash
npm install
```

## 7. Create DynamoDB Table

Make sure FLOCI is running and the AWS CLI profile is configured.

Set the local environment:

```bash
export AWS_PROFILE=floci
export DYNAMODB_ENDPOINT=http://localhost:4566
export MSYS_NO_PATHCONV=1
```

Create the DynamoDB table by running:

```bash
npm run create-table
```

The script creates the `Packages` table if it does not already exist.

If the table already exists, the script reports that it is already available.

## 8. Seed Sample Packages

To insert sample tour packages into the DynamoDB table, run:

```bash
npm run seed
```

The seed script provides three sample packages:

- Giza Pyramids Adventure
- Alexandria Weekend
- Cairo City Adventure

The script uses fixed package IDs and checks existing packages by title and destination before inserting.

Existing sample packages are skipped to prevent duplicate records.

This allows the same seed command to be used on a fresh database or an existing database without overwriting existing package records.

Make sure FLOCI is running and the AWS profile and DynamoDB endpoint are configured before running the script.

## 9. Run Locally

From `package_service/src`, configure the local FLOCI environment:

```bash
export AWS_PROFILE=floci
export DYNAMODB_ENDPOINT=http://localhost:4566
export MSYS_NO_PATHCONV=1
```

Start the service:

```bash
npm start
```

The local package service runs on port `3001`.

## 10. Deploy Using FLOCI

The deployment script builds the whole service on a fresh Floci, so it works on any team laptop:

`package_service/infra/deploy-lambda.sh`

It creates anything that is missing and updates anything that already exists, so it is safe to run again:

1. **IAM role** `PackageServiceLambdaRole` using `infra/lambda/trust-policy.json` and `infra/lambda/permissions-policy.json`
2. **DynamoDB table** `Packages`, plus the sample packages (skip with `SKIP_SEED=1`)
3. **Lambda function** `PackageServiceLambda` (runtime `nodejs24.x`, handler `lambda.handler`)
4. **API Gateway REST API** with the fixed id `packages-api`, a `{proxy+}` route to the Lambda, and stage `dev`
5. **`Frontend/js/config.js`** is updated to use the API Gateway URL
6. **S3 website** `tour-package-web` with `index.html`, `css/` and `js/` (skip with `SKIP_WEBSITE=1`)

Start Floci first, then run the script from the repository root (Git Bash, macOS or Linux):

```bash
docker compose -f infra/floci/docker-compose.yml up -d
bash package_service/infra/deploy-lambda.sh
```

The application is then available at:

- Website: `http://localhost:4566/tour-package-web/index.html`
- API: `http://localhost:4566/restapis/packages-api/dev/_user_request_`

The Lambda gets these environment variables: `DYNAMODB_TABLE`, `DYNAMODB_ENDPOINT`, `CORS_ORIGINS`, `NODE_ENV=production`, `STAFF_GROUP` and the Cognito settings. Every request is logged as one line (method, path, status, time) in CloudWatch Logs under `/aws/lambda/PackageServiceLambda`.

Only Node.js, npm and the AWS CLI are needed. The ZIP is built with Node, so PowerShell is no longer required.

To only build the deployment ZIP (saved to `package_service/dist/package-service.zip`):

```bash
bash package_service/infra/deploy-lambda.sh --build-only
# or, from package_service/src after npm install:
npm run zip
```

### Staff login settings

The script detects the team Cognito user pool and app client when Floci has exactly one of each. Otherwise set them before running:

```bash
export COGNITO_USER_POOL_ID=us-east-1_xxxxxxxx
export COGNITO_CLIENT_ID=xxxxxxxxxxxxxxxx
export STAFF_GROUP=staff     # Cognito group that counts as staff
bash package_service/infra/deploy-lambda.sh
```

The Lambda receives `COGNITO_ISSUER`, `COGNITO_JWKS_URL`, `COGNITO_CLIENT_ID` and `STAFF_GROUP`. Without them, staff-only endpoints answer `503`.

## 11. API Endpoints

Staff-only endpoints need the header `Authorization: Bearer <Cognito ID token>` from a user in the staff group.

| Method | Endpoint | Access | Description |
|---|---|---|---|
| GET | `/` | Public | Check the package server |
| GET | `/health` | Public | Check service and database health |
| GET | `/packages?destination=&startDate=&endDate=&maxPrice=` | Public | Search published packages (all filters optional) |
| GET | `/packages?isPublished=false` | Staff | Retrieve draft (unpublished) packages |
| GET | `/packages?includeUnpublished=true` | Staff | Retrieve all packages (published and drafts) |
| POST | `/packages` | Staff | Create a new package (draft unless `isPublished: true`) |
| GET | `/packages/:packageID` | Public | Retrieve a package by ID |
| PUT | `/packages/:packageID` | Staff | Edit a package; publish (`{"isPublished": true}`) or hide (`false`) |
| PATCH | `/packages/:packageID/reserve` | Booking service | Reserve seats |
| PATCH | `/packages/:packageID/release` | Booking service | Release reserved seats |
| GET | `/packages/:packageID/convert?currency=USD` | Public | Package price in another currency (external API) |

The old `PATCH /packages/:packageID/seats` endpoint was removed: it let anyone set any seat number. Seats now only change through `/reserve` and `/release`. `seatsLeft` also cannot be set through `PUT`; changing `totalSeats` moves `seatsLeft` by the same amount, so existing bookings are kept.

### Search rules

- `destination` matches part of the name in any letter case (`alex` finds `Alexandria`).
- `startDate`: trips starting on or after this date. `endDate`: trips ending on or before this date.
- `maxPrice`: price in EGP, at most this value.
- Results are sorted with the soonest trip first.

### Validation and responses

| Case | Response |
|---|---|
| Missing required fields on create | `400`, message names the missing fields |
| Price not a number, negative or above 1,000,000 | `400` |
| Total seats not a whole number between 1 and 1000 | `400` |
| Date not a real `YYYY-MM-DD` date, or end before start (also on edit) | `400` |
| Empty itinerary, more than 30 activities, or activity over 200 characters | `400` |
| Title over 100 or destination over 60 characters, or text containing `<` or `>` | `400` |
| Setting `seatsLeft` directly, or lowering `totalSeats` below the booked seats | `400` |
| Invalid search filter (e.g. `maxPrice=abc`) | `400` |
| Invalid travelers on reserve/release | `400` |
| Malformed JSON body | `400` `{"message":"Request body must be valid JSON"}` |
| No login / not staff / expired or forged token | `401` / `403` / `401` |
| Package not found / unknown route | `404` JSON |
| Not enough seats / release beyond capacity / booking during a capacity change | `409` |
| Unsupported currency | `400` |
| Exchange-rate API down or too slow (5 s timeout) | `502` |

Every response also carries security headers (`nosniff`, `X-Frame-Options: DENY`, a strict Content-Security-Policy). CORS only allows the sites listed in `CORS_ORIGINS`.

## 12. Testing

Automated tests (33 cases: normal, invalid and security) run offline with a local DynamoDB emulator, a fake Cognito key server and a fake exchange-rate API:

```bash
cd package_service/src
npm install
npm test
```

The test IDs, scenarios, expected and actual results are listed in `docs/package-service-tests.md`.

After deployment, test the live system through the website and API Gateway URL (see the "After deployment" section of that file).

## 13. Notes

- FLOCI must be running before local database operations.
- The DynamoDB table must exist before inserting or retrieving packages.
- The local DynamoDB endpoint is different from the endpoint used by Lambda.
- The seed script does not overwrite existing packages.
- The `Packages` table uses `packageId` as its partition key.
- Generated deployment ZIP files and temporary test artifacts should not be committed to Git.
- The frontend never uses `innerHTML` for package data, so package text cannot inject HTML.