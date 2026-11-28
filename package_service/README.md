# Package Service

## 1. Overview

The Package Service is responsible for managing tour packages in the Tour Package Booking Request System.

It provides REST API endpoints to create, retrieve, update, and manage tour packages and their available seats.

The service uses AWS DynamoDB for data storage and FLOCI for local cloud-service emulation.

## 2. Architecture

The deployment architecture is:

**Frontend → FLOCI API Gateway → FLOCI Lambda → DynamoDB**

Technologies used:

- Node.js
- Express.js
- AWS SDK for JavaScript
- Amazon DynamoDB
- AWS Lambda
- API Gateway
- FLOCI
- Docker

## 3. Project Structure

```text
package_service/
│
├── README.md
├── infra/
│   └── deploy-lambda.sh
│
└── src/
    ├── config/
    │   └── dynamodb.js
    │
    ├── controllers/
    │   └── packageController.js
    │
    ├── routes/
    │   └── packageRoutes.js
    │
    ├── services/
    │   └── packageService.js
    │
    ├── scripts/
    │   ├── create-packages-table.js
    │   └── seed-packages.js
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

The Package Service is deployed using FLOCI Lambda and API Gateway.

The deployment script is located at:

`package_service/infra/deploy-lambda.sh`

The Lambda configuration uses:

- Function name: `PackageServiceLambda`
- Runtime: `nodejs24.x`
- Handler: `lambda.handler`
- DynamoDB table: `Packages`
- DynamoDB endpoint: `http://host.docker.internal:4566`

The deployment script prepares the Lambda package, installs production dependencies, creates the deployment ZIP file, configures the Lambda environment, and uploads the code.

Run the deployment script from the repository root using the supported Git Bash environment:

```bash
bash package_service/infra/deploy-lambda.sh
```

## 11. API Endpoints

The Package Service provides the following endpoints:

| Method | Endpoint | Description |
|---|---|---|
| GET | `/` | Check the package server |
| GET | `/health` | Check service and database health |
| GET | `/packages` | Retrieve all published packages |
| POST | `/packages` | Create a new package |
| GET | `/packages/:packageID` | Retrieve a package by ID |
| PUT | `/packages/:packageID` | Update package information |
| PATCH | `/packages/:packageID/seats` | Update available seats |
| PATCH | `/packages/:packageID/reserve` | Reserve seats |
| PATCH | `/packages/:packageID/release` | Release reserved seats |
| GET | `/packages/:packageID/convert` | Convert package information |

## 12. Testing

The following operations have been tested successfully through the FLOCI API Gateway:

- GET `/health` — returned HTTP 200 and confirmed DynamoDB connectivity.
- GET `/packages` — retrieved package records.
- POST `/packages` — created a new package.
- GET `/packages/:packageID` — retrieved a package by ID.
- PUT `/packages/:packageID` — updated package information.
- PATCH `/packages/:packageID/reserve` — successfully reserved seats.
- PATCH `/packages/:packageID/release` — successfully released seats.

The seed script was also tested against the existing database. It correctly skipped all three sample packages because they were already present.

## 13. Notes

- FLOCI must be running before local database operations.
- The DynamoDB table must exist before inserting or retrieving packages.
- The local DynamoDB endpoint is different from the endpoint used by Lambda.
- The seed script does not overwrite existing packages.
- The `Packages` table uses `packageId` as its partition key.
- Generated deployment ZIP files and temporary test artifacts should not be committed to Git.