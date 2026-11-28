# Tour Package Booking Request System

A cloud web application for travel agencies. Staff publish tour packages, and customers browse them and send booking requests that move through a fixed status flow.

This folder holds the **Package Service** and its web page. The Booking Request and Review & Notification services live in their owners' folders and call this service's API.

## Architecture

**Browser (S3 website) → API Gateway → Lambda (Express) → DynamoDB**, plus the Frankfurter exchange-rate API for price conversion. Everything runs on Floci (local AWS emulator).

| Layer | What it does | Cloud service |
|---|---|---|
| Presentation | HTML/CSS/JS page: search, details, currency conversion, staff management | Amazon S3 (static website) |
| Application | Package Service REST API with business rules and staff-only routes | API Gateway + AWS Lambda (Node.js/Express), IAM, CloudWatch Logs |
| Data | Packages table | Amazon DynamoDB |
| External | Live exchange rates (EGP to other currencies) | Frankfurter API |
| Identity | Staff login and the staff group | Amazon Cognito (shared team user pool) |

## Repository structure

```text
.
├── Frontend/                  Web page (deployed to S3)
│   ├── index.html
│   ├── css/style.css
│   └── js/
│       ├── app.js             Calls the API, renders packages (no innerHTML)
│       ├── config.js          API Gateway URL + Cognito settings (written by the deploy script)
│       └── config.docker.js   Settings for the Docker version
├── package_service/
│   ├── README.md              Service documentation (endpoints, validation, tests)
│   ├── infra/deploy-lambda.sh Full Floci deployment (IAM, DynamoDB, Lambda, API Gateway, S3)
│   └── src/                   Node.js/Express source, scripts and tests
├── infra/
│   ├── floci/docker-compose.yml   Starts Floci
│   └── lambda/*.json              IAM trust and least-privilege permission policies
├── docs/package-service-tests.md  Test cases and results
└── docker-compose.yml         Optional local run with Docker (backend + nginx frontend)
```

## Quick start (Floci)

```bash
docker compose -f infra/floci/docker-compose.yml up -d
bash package_service/infra/deploy-lambda.sh
```

The script prints two addresses:

- **Website:** `http://localhost:4566/tour-package-web/index.html`
- **API:** `http://localhost:4566/restapis/packages-api/dev/_user_request_`

## Tests

```bash
cd package_service/src
npm install
npm test
```

The tests run offline and cover normal, invalid and security cases. The results are in `docs/package-service-tests.md`.

## Configuration and secrets

All settings come from environment variables (see `package_service/src/.env.example`). `.env` files are ignored by Git. The exchange-rate API needs no key.
