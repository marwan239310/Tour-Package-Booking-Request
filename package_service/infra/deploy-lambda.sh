#!/usr/bin/env bash
# ==========================================================================
# Package Service: full deployment to Floci (works on a fresh Floci)
#
# Creates whatever is missing and updates whatever already exists, so it is
# safe to run again and again:
#   1. IAM role + inline policy  (infra/lambda/*.json)
#   2. DynamoDB "Packages" table (+ sample data)
#   3. Lambda function           (create or update code/config)
#   4. API Gateway REST API      (fixed id, {proxy+} -> Lambda, stage "dev")
#   5. Frontend/js/config.js     (points the page at the API Gateway URL)
#   6. S3 website bucket         (hosts the frontend: index.html, css/, js/)
#
# Usage (from the repository root, Git Bash / macOS / Linux):
#   bash package_service/infra/deploy-lambda.sh
#   bash package_service/infra/deploy-lambda.sh --build-only   # only build the ZIP
#
# Optional environment variables:
#   COGNITO_USER_POOL_ID, COGNITO_CLIENT_ID  team Cognito pool (auto-detected
#                                            when Floci has exactly one)
#   STAFF_GROUP=staff                        Cognito group allowed to manage packages
#   SKIP_SEED=1                              do not insert the sample packages
#   SKIP_WEBSITE=1                           do not upload the frontend to S3
#   CORS_ORIGINS                             websites allowed to call the API
#   AWS_PROFILE=floci                        use a named profile instead of test keys
# ==========================================================================
set -euo pipefail

# ------------------------------------------
# Configuration
# ------------------------------------------
FUNCTION_NAME="${FUNCTION_NAME:-PackageServiceLambda}"
ROLE_NAME="${ROLE_NAME:-PackageServiceLambdaRole}"
ROLE_POLICY_NAME="${ROLE_POLICY_NAME:-PackageServiceLambdaPolicy}"
API_NAME="${API_NAME:-PackageServiceApi}"
API_ID="${API_ID:-packages-api}"          # fixed id via Floci's floci:override-id tag
STAGE_NAME="${STAGE_NAME:-dev}"
TABLE_NAME="${DYNAMODB_TABLE:-Packages}"
RUNTIME="${LAMBDA_RUNTIME:-nodejs24.x}"
AWS_REGION="${AWS_REGION:-us-east-1}"
ENDPOINT_URL="${ENDPOINT_URL:-http://localhost:4566}"
# Lambda runs inside a container, so it reaches Floci through the Docker host
LAMBDA_DYNAMODB_ENDPOINT="${LAMBDA_DYNAMODB_ENDPOINT:-http://host.docker.internal:4566}"
STAFF_GROUP="${STAFF_GROUP:-staff}"
WEBSITE_BUCKET="${WEBSITE_BUCKET:-tour-package-web}"
CORS_ORIGINS="${CORS_ORIGINS:-http://localhost:4566,http://localhost:8080}"

BUILD_ONLY="${BUILD_ONLY:-0}"
if [[ "${1:-}" == "--build-only" ]]; then
    BUILD_ONLY=1
fi

# Floci accepts any credentials; only use test keys if no profile was chosen
if [[ -z "${AWS_PROFILE:-}" ]]; then
    export AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID:-test}"
    export AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY:-test}"
fi
export AWS_DEFAULT_REGION="$AWS_REGION"
export AWS_PAGER=""
export MSYS_NO_PATHCONV=1   # stop Git Bash from rewriting arguments such as "/{proxy+}"

awsf() {
    aws --endpoint-url "$ENDPOINT_URL" --region "$AWS_REGION" --cli-read-timeout 0 "$@"
}

# Git Bash's aws.exe needs Windows paths for file:// arguments
native_path() {
    if command -v cygpath >/dev/null 2>&1; then
        cygpath -m "$1"
    else
        echo "$1"
    fi
}

step() {
    echo
    echo "==> $*"
}

# ------------------------------------------
# Locate project directories
# ------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SOURCE_DIR="$SERVICE_DIR/src"
REPO_ROOT="$(cd "$SERVICE_DIR/.." && pwd)"
POLICY_DIR="$REPO_ROOT/infra/lambda"
FRONTEND_DIR="$REPO_ROOT/Frontend"
FRONTEND_CONFIG="$FRONTEND_DIR/js/config.js"

TEMP_DIR="$(mktemp -d)"
BUILD_DIR="$TEMP_DIR/build"
ZIP_FILE="$TEMP_DIR/package-service.zip"

cleanup() {
    rm -rf "$TEMP_DIR"
}
trap cleanup EXIT

# ------------------------------------------
# Check required tools and files
# ------------------------------------------
REQUIRED_TOOLS=(node npm)
[[ "$BUILD_ONLY" == "1" ]] || REQUIRED_TOOLS+=(aws)

for tool in "${REQUIRED_TOOLS[@]}"; do
    if ! command -v "$tool" >/dev/null 2>&1; then
        echo "ERROR: Required tool '$tool' was not found."
        exit 1
    fi
done

for file in lambda.js server.js package.json package-lock.json scripts/zip-lambda.js; do
    if [[ ! -f "$SOURCE_DIR/$file" ]]; then
        echo "ERROR: $SOURCE_DIR/$file is missing."
        exit 1
    fi
done

for file in trust-policy.json permissions-policy.json; do
    if [[ ! -f "$POLICY_DIR/$file" ]]; then
        echo "ERROR: $POLICY_DIR/$file is missing."
        exit 1
    fi
done

# ------------------------------------------
# Build the deployment package
# ------------------------------------------
step "Building the Lambda package"

mkdir -p "$BUILD_DIR"
cp -R "$SOURCE_DIR"/. "$BUILD_DIR"/
rm -rf "$BUILD_DIR/node_modules"
rm -f "$BUILD_DIR"/.env "$BUILD_DIR"/*.zip

(cd "$BUILD_DIR" && npm ci --omit=dev --no-audit --no-fund)

node "$(native_path "$BUILD_DIR")/scripts/zip-lambda.js" "$(native_path "$BUILD_DIR")" "$(native_path "$ZIP_FILE")"

if [[ "$BUILD_ONLY" == "1" ]]; then
    mkdir -p "$SERVICE_DIR/dist"
    cp "$ZIP_FILE" "$SERVICE_DIR/dist/package-service.zip"
    echo "BUILD-ONLY: archive saved to package_service/dist/package-service.zip"
    exit 0
fi

# ------------------------------------------
# Check that Floci is running
# ------------------------------------------
step "Checking Floci at $ENDPOINT_URL"
if ! awsf sts get-caller-identity >/dev/null 2>&1; then
    echo "ERROR: Floci is not reachable at $ENDPOINT_URL."
    echo "Start it first:  docker compose -f infra/floci/docker-compose.yml up -d"
    exit 1
fi
ACCOUNT_ID="$(awsf sts get-caller-identity --query Account --output text 2>/dev/null || echo 000000000000)"

# ------------------------------------------
# 1. IAM role
# ------------------------------------------
step "IAM role: $ROLE_NAME"

if ROLE_ARN="$(awsf iam get-role --role-name "$ROLE_NAME" --query Role.Arn --output text 2>/dev/null)"; then
    echo "Role already exists."
else
    ROLE_ARN="$(awsf iam create-role \
        --role-name "$ROLE_NAME" \
        --assume-role-policy-document "file://$(native_path "$POLICY_DIR/trust-policy.json")" \
        --query Role.Arn --output text)"
    echo "Role created."
fi

awsf iam put-role-policy \
    --role-name "$ROLE_NAME" \
    --policy-name "$ROLE_POLICY_NAME" \
    --policy-document "file://$(native_path "$POLICY_DIR/permissions-policy.json")"
echo "Permissions policy attached: $ROLE_ARN"

# ------------------------------------------
# 2. DynamoDB table + sample data
# ------------------------------------------
step "DynamoDB table: $TABLE_NAME"

if awsf dynamodb describe-table --table-name "$TABLE_NAME" >/dev/null 2>&1; then
    echo "Table already exists."
else
    awsf dynamodb create-table \
        --table-name "$TABLE_NAME" \
        --attribute-definitions AttributeName=packageId,AttributeType=S \
        --key-schema AttributeName=packageId,KeyType=HASH \
        --billing-mode PAY_PER_REQUEST >/dev/null
    awsf dynamodb wait table-exists --table-name "$TABLE_NAME" || true
    echo "Table created."
fi

if [[ "${SKIP_SEED:-0}" != "1" ]]; then
    echo "Seeding sample packages (existing ones are skipped)..."
    (cd "$BUILD_DIR" && \
        DYNAMODB_ENDPOINT="$ENDPOINT_URL" DYNAMODB_TABLE="$TABLE_NAME" AWS_REGION="$AWS_REGION" \
        node scripts/seed-packages.js)
fi

# ------------------------------------------
# Cognito settings for the staff-only endpoints
# ------------------------------------------
step "Cognito (staff login)"

COGNITO_USER_POOL_ID="${COGNITO_USER_POOL_ID:-}"
COGNITO_CLIENT_ID="${COGNITO_CLIENT_ID:-}"

if [[ -z "$COGNITO_USER_POOL_ID" ]]; then
    POOLS="$(awsf cognito-idp list-user-pools --max-results 20 --query 'UserPools[].Id' --output text 2>/dev/null || true)"
    if [[ -n "$POOLS" && "$POOLS" != "None" && $(wc -w <<<"$POOLS") -eq 1 ]]; then
        COGNITO_USER_POOL_ID="$POOLS"
        echo "Using the only user pool found: $COGNITO_USER_POOL_ID"
    fi
fi

if [[ -n "$COGNITO_USER_POOL_ID" && -z "$COGNITO_CLIENT_ID" ]]; then
    CLIENTS="$(awsf cognito-idp list-user-pool-clients --user-pool-id "$COGNITO_USER_POOL_ID" \
        --query 'UserPoolClients[].ClientId' --output text 2>/dev/null || true)"
    if [[ -n "$CLIENTS" && "$CLIENTS" != "None" && $(wc -w <<<"$CLIENTS") -eq 1 ]]; then
        COGNITO_CLIENT_ID="$CLIENTS"
        echo "Using the only app client found: $COGNITO_CLIENT_ID"
    fi
fi

COGNITO_ISSUER="${COGNITO_ISSUER:-}"
COGNITO_JWKS_URL="${COGNITO_JWKS_URL:-}"

if [[ -n "$COGNITO_USER_POOL_ID" ]]; then
    if [[ -z "$COGNITO_ISSUER" ]] && command -v curl >/dev/null 2>&1; then
        # Ask Floci which issuer it writes into the tokens
        COGNITO_ISSUER="$(curl -fsS "$ENDPOINT_URL/$COGNITO_USER_POOL_ID/.well-known/openid-configuration" 2>/dev/null \
            | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(JSON.parse(s).issuer||"")}catch{}})' || true)"
    fi
    COGNITO_ISSUER="${COGNITO_ISSUER:-$ENDPOINT_URL/$COGNITO_USER_POOL_ID}"

    if [[ -z "$COGNITO_JWKS_URL" ]]; then
        # The Lambda container cannot use "localhost" to reach Floci
        COGNITO_JWKS_URL="$(echo "$COGNITO_ISSUER/.well-known/jwks.json" \
            | sed -E 's#//(localhost|127\.0\.0\.1)([:/])#//host.docker.internal\2#')"
    fi

    echo "Issuer:   $COGNITO_ISSUER"
    echo "JWKS URL: $COGNITO_JWKS_URL (as seen from the Lambda)"
    echo "Staff group: $STAFF_GROUP"
else
    echo "WARNING: No Cognito user pool found."
    echo "         Create, edit and draft-listing endpoints will answer 503 until you"
    echo "         re-run with COGNITO_USER_POOL_ID and COGNITO_CLIENT_ID set."
fi

# ------------------------------------------
# 3. Lambda function
# ------------------------------------------
step "Lambda function: $FUNCTION_NAME"

ENV_FILE="$TEMP_DIR/lambda-env.json"
LAMBDA_DYNAMODB_ENDPOINT="$LAMBDA_DYNAMODB_ENDPOINT" TABLE_NAME="$TABLE_NAME" \
COGNITO_ISSUER="$COGNITO_ISSUER" COGNITO_JWKS_URL="$COGNITO_JWKS_URL" \
COGNITO_CLIENT_ID="$COGNITO_CLIENT_ID" STAFF_GROUP="$STAFF_GROUP" CORS_ORIGINS="$CORS_ORIGINS" \
node -e '
const e = process.env;
const vars = {
    DYNAMODB_TABLE: e.TABLE_NAME,
    DYNAMODB_ENDPOINT: e.LAMBDA_DYNAMODB_ENDPOINT,
    STAFF_GROUP: e.STAFF_GROUP,
    CORS_ORIGINS: e.CORS_ORIGINS,
    NODE_ENV: "production"
};
if (e.COGNITO_ISSUER) vars.COGNITO_ISSUER = e.COGNITO_ISSUER;
if (e.COGNITO_JWKS_URL) vars.COGNITO_JWKS_URL = e.COGNITO_JWKS_URL;
if (e.COGNITO_CLIENT_ID) vars.COGNITO_CLIENT_ID = e.COGNITO_CLIENT_ID;
process.stdout.write(JSON.stringify({ Variables: vars }));
' > "$ENV_FILE"

ZIP_ARG="fileb://$(native_path "$ZIP_FILE")"
ENV_ARG="file://$(native_path "$ENV_FILE")"

if awsf lambda get-function --function-name "$FUNCTION_NAME" >/dev/null 2>&1; then
    echo "Function exists, updating code and configuration..."
    awsf lambda update-function-code \
        --function-name "$FUNCTION_NAME" \
        --zip-file "$ZIP_ARG" >/dev/null
    awsf lambda wait function-updated-v2 --function-name "$FUNCTION_NAME" 2>/dev/null || true

    awsf lambda update-function-configuration \
        --function-name "$FUNCTION_NAME" \
        --role "$ROLE_ARN" \
        --runtime "$RUNTIME" \
        --handler lambda.handler \
        --timeout 30 \
        --memory-size 256 \
        --environment "$ENV_ARG" >/dev/null
    awsf lambda wait function-updated-v2 --function-name "$FUNCTION_NAME" 2>/dev/null || true
else
    echo "Creating function..."
    awsf lambda create-function \
        --function-name "$FUNCTION_NAME" \
        --runtime "$RUNTIME" \
        --handler lambda.handler \
        --role "$ROLE_ARN" \
        --timeout 30 \
        --memory-size 256 \
        --zip-file "$ZIP_ARG" \
        --environment "$ENV_ARG" >/dev/null
    awsf lambda wait function-active-v2 --function-name "$FUNCTION_NAME" 2>/dev/null || true
fi

LAMBDA_ARN="$(awsf lambda get-function --function-name "$FUNCTION_NAME" \
    --query Configuration.FunctionArn --output text)"
echo "Lambda ready: $LAMBDA_ARN"

# ------------------------------------------
# 4. API Gateway (REST API with Lambda proxy)
# ------------------------------------------
step "API Gateway: $API_NAME (id: $API_ID)"

if awsf apigateway get-rest-api --rest-api-id "$API_ID" >/dev/null 2>&1; then
    echo "REST API already exists."
else
    CREATED_ID="$(awsf apigateway create-rest-api \
        --name "$API_NAME" \
        --description "Tour Package Service API" \
        --endpoint-configuration types=REGIONAL \
        --tags "{\"floci:override-id\":\"$API_ID\"}" \
        --query id --output text)"
    if [[ "$CREATED_ID" != "$API_ID" ]]; then
        echo "NOTE: Floci returned id '$CREATED_ID' instead of '$API_ID'; using it."
        API_ID="$CREATED_ID"
    fi
    echo "REST API created."
fi

ROOT_ID="$(awsf apigateway get-resources --rest-api-id "$API_ID" \
    --query "items[?path=='/'].id | [0]" --output text)"

PROXY_ID="$(awsf apigateway get-resources --rest-api-id "$API_ID" \
    --query "items[?path=='/{proxy+}'].id | [0]" --output text)"
if [[ -z "$PROXY_ID" || "$PROXY_ID" == "None" ]]; then
    PROXY_ID="$(awsf apigateway create-resource \
        --rest-api-id "$API_ID" \
        --parent-id "$ROOT_ID" \
        --path-part "{proxy+}" \
        --query id --output text)"
    echo "Created /{proxy+} resource."
fi

INTEGRATION_URI="arn:aws:apigateway:${AWS_REGION}:lambda:path/2015-03-31/functions/${LAMBDA_ARN}/invocations"

# ANY on "/" and "/{proxy+}" -> Lambda. Login is checked inside the Lambda
# (staff-only routes), so the gateway itself does not use an authorizer.
for RESOURCE_ID in "$ROOT_ID" "$PROXY_ID"; do
    awsf apigateway put-method \
        --rest-api-id "$API_ID" \
        --resource-id "$RESOURCE_ID" \
        --http-method ANY \
        --authorization-type NONE >/dev/null 2>&1 || true

    awsf apigateway put-integration \
        --rest-api-id "$API_ID" \
        --resource-id "$RESOURCE_ID" \
        --http-method ANY \
        --type AWS_PROXY \
        --integration-http-method POST \
        --uri "$INTEGRATION_URI" >/dev/null
done
echo "Methods and Lambda proxy integration configured."

awsf lambda add-permission \
    --function-name "$FUNCTION_NAME" \
    --statement-id "apigateway-${API_ID}" \
    --action lambda:InvokeFunction \
    --principal apigateway.amazonaws.com \
    --source-arn "arn:aws:execute-api:${AWS_REGION}:${ACCOUNT_ID}:${API_ID}/*/*/*" \
    >/dev/null 2>&1 || true

awsf apigateway create-deployment \
    --rest-api-id "$API_ID" \
    --stage-name "$STAGE_NAME" \
    --description "Deployed by deploy-lambda.sh" >/dev/null
echo "Deployed to stage '$STAGE_NAME'."

API_URL="${ENDPOINT_URL}/restapis/${API_ID}/${STAGE_NAME}/_user_request_"

# ------------------------------------------
# 5. Point the frontend at the API Gateway
# ------------------------------------------
if [[ "${UPDATE_FRONTEND_CONFIG:-1}" == "1" && -d "$(dirname "$FRONTEND_CONFIG")" ]]; then
    step "Updating Frontend/js/config.js"
    API_URL="$API_URL" ENDPOINT_URL="$ENDPOINT_URL" COGNITO_CLIENT_ID="$COGNITO_CLIENT_ID" \
    node -e '
const fs = require("fs");
const e = process.env;
const file = process.argv[1];
const text = `// Written by package_service/infra/deploy-lambda.sh. Safe to edit by hand.
// Package Service API on Floci (API Gateway -> Lambda -> DynamoDB)
const API_BASE_URL = ${JSON.stringify(e.API_URL)};

// Team staff login (Cognito on Floci)
const COGNITO_ENDPOINT = ${JSON.stringify(e.ENDPOINT_URL + "/")};
const COGNITO_CLIENT_ID = ${JSON.stringify(e.COGNITO_CLIENT_ID || "")};
// localStorage key where the team login keeps the staff ID token
const AUTH_TOKEN_STORAGE_KEY = "staffIdToken";
`;
fs.writeFileSync(file, text);
' "$(native_path "$FRONTEND_CONFIG")"
    echo "config.js now uses $API_URL"
fi

# ------------------------------------------
# 6. Frontend website on S3
# ------------------------------------------
WEBSITE_URL=""
if [[ "${SKIP_WEBSITE:-0}" != "1" && -f "$FRONTEND_DIR/index.html" ]]; then
    step "S3 website: $WEBSITE_BUCKET"

    if awsf s3api head-bucket --bucket "$WEBSITE_BUCKET" >/dev/null 2>&1; then
        echo "Bucket already exists."
    else
        awsf s3 mb "s3://$WEBSITE_BUCKET" >/dev/null
        echo "Bucket created."
    fi

    awsf s3 website "s3://$WEBSITE_BUCKET" --index-document index.html >/dev/null 2>&1 || true

    # Only the browser files go into the public bucket (no Dockerfile, no Docker config)
    FRONTEND_NATIVE="$(native_path "$FRONTEND_DIR")"
    awsf s3 cp "$FRONTEND_NATIVE/index.html" "s3://$WEBSITE_BUCKET/index.html" \
        --content-type "text/html; charset=utf-8" >/dev/null
    awsf s3 cp "$FRONTEND_NATIVE/css" "s3://$WEBSITE_BUCKET/css" --recursive \
        --content-type "text/css; charset=utf-8" >/dev/null
    awsf s3 cp "$FRONTEND_NATIVE/js" "s3://$WEBSITE_BUCKET/js" --recursive \
        --exclude "config.docker.js" --content-type "text/javascript; charset=utf-8" >/dev/null

    WEBSITE_URL="${ENDPOINT_URL}/${WEBSITE_BUCKET}/index.html"
    echo "Uploaded:"
    awsf s3 ls "s3://$WEBSITE_BUCKET" --recursive
fi

# ------------------------------------------
# Smoke test
# ------------------------------------------
step "Smoke test"
if command -v curl >/dev/null 2>&1; then
    if curl -fsS "$API_URL/health"; then
        echo
    else
        echo "WARNING: $API_URL/health did not answer yet (the first Lambda start can be slow)."
    fi
fi

echo
echo "Package Service deployed."
echo "API URL:     $API_URL"
if [[ -n "$WEBSITE_URL" ]]; then
    echo "Website URL: $WEBSITE_URL"
fi