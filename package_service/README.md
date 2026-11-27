# Package Service



## 1. Overview



The Package Service manages tour packages in the Tour Package Booking Request System.



It provides REST API endpoints to create, retrieve, update, and manage tour packages and their available seats.



## 2. Architecture



The service uses the following architecture:



**Frontend → FLOCI API Gateway → FLOCI Lambda → DynamoDB**



Technologies:

- Node.js

- Express.js

- AWS Lambda

- API Gateway HTTP API

- Amazon DynamoDB

- AWS SDK for JavaScript v3

- serverless-http

- FLOCI



## 3. Project Structure



```text

package_service/

├── infra/

│   └── deploy-lambda.sh

├── src/

│   ├── config/

│   │   └── dynamodb.js

│   ├── controllers/

│   ├── routes/

│   ├── scripts/

│   │   └── create-packages-table.js

│   ├── services/

│   ├── lambda.js

│   ├── server.js

│   ├── package.json

│   └── package-lock.json

└── README.md

```



## 4. Database Configuration



The service uses DynamoDB through the AWS SDK.



- **Table name:** `Packages`

- **Partition key:** `packageId` (String)

- **Local FLOCI endpoint:** `http://localhost:4566`

- **Lambda DynamoDB endpoint:** `http://host.docker.internal:4566`



Lambda environment variables:



```text

DYNAMODB_TABLE=Packages

DYNAMODB_ENDPOINT=http://host.docker.internal:4566

```



## 5. Prerequisites



The following tools are required:



- Node.js and npm

- Git Bash

- Docker Desktop

- FLOCI

- AWS CLI

- PowerShell



The AWS CLI must have a FLOCI profile named `floci`, configured for region `us-east-1`.



## 6. Install Dependencies



From the project root:



```bash

cd package_service/src

npm install

```



## 7. Create the DynamoDB Table



Make sure FLOCI is running.



From `package_service/src`, execute:



```bash

npm run create-table

```



The script creates the `Packages` table if it does not already exist. If the table already exists, it reports that and leaves it unchanged.



## 8. Run the Service Locally



From `package_service/src`, run:



```bash

npm start

```



## 9. Deploy to FLOCI Lambda



Make sure Docker Desktop and FLOCI are running and the AWS CLI `floci` profile is configured.



From the project root, execute:



```bash

bash package_service/infra/deploy-lambda.sh

```



The deployment script:



1\. Prepares a temporary deployment directory.

2\. Installs production dependencies.

3\. Creates and validates the Lambda ZIP archive.

4\. Updates the Lambda environment variables.

5\. Uploads the deployment package to FLOCI Lambda.



- **Lambda function:** `PackageServiceLambda`

- **Lambda handler:** `lambda.handler`



## 10. API Endpoints



| Method | Endpoint | Description |

|---|---|---|

| GET | `/` | Service information |

| GET | `/health` | Checks service and DynamoDB connectivity |

| GET | `/packages` | Retrieves all packages |

| POST | `/packages` | Creates a package |

| GET | `/packages/:packageID` | Retrieves one package |

| PUT | `/packages/:packageID` | Updates a package |

| PATCH | `/packages/:packageID/seats` | Updates package seat availability |

| PATCH | `/packages/:packageID/reserve` | Reserves seats |

| PATCH | `/packages/:packageID/release` | Releases reserved seats |

| GET | `/packages/:packageID/convert` | Converts package information |



## 11. Testing



The service was tested through the FLOCI API Gateway endpoint.



The following operations were successfully tested:



- Health check and DynamoDB connectivity.

- Retrieving all packages.

- Creating a new package.

- Retrieving a package by its ID.

- Updating package information.

- Reserving seats.

- Releasing reserved seats.



Example health-check response:



```json

{

&#x20; "status": "OK",

&#x20; "database": "DynamoDB Connected"

}

```



## 12. Important Notes



- FLOCI must be running before deploying or testing the service.

- The Lambda function must use `http://host.docker.internal:4566` to reach DynamoDB.

- Do not use `localhost` as the DynamoDB endpoint inside the Lambda container.

- The deployment script excludes local `.env` files from the deployment package.

- The DynamoDB table must exist before the service can retrieve or store packages.

