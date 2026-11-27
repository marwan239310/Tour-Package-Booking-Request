#!/usr/bin/env bash
# Deploys the booking request service to Floci in one command (safe to run again):
#   IAM role -> Lambda function -> API Gateway (routes) -> permission
# Before the first run:  bash infra/setup-aws.sh
# Run from the booking_service folder:  bash infra/deploy-lambda.sh
# Optional: PACKAGE_SERVICE_URL=http://... bash infra/deploy-lambda.sh  (where Lambda can reach the package service)
export AWS_PROFILE=floci AWS_PAGER="" MSYS_NO_PATHCONV=1
cd "$(dirname "$0")/.." || exit 1

REGION=us-east-1
ACCOUNT=000000000000
FN=booking-request-service
ROLE=booking-request-service-role
API_NAME=booking-request-api
TOPIC_ARN=arn:aws:sns:$REGION:$ACCOUNT:booking-status-topic
# The Lambda runs inside Docker, so "localhost" there is not your PC: use host.docker.internal
PACKAGE_URL=${PACKAGE_SERVICE_URL:-http://host.docker.internal:3001}

ENV_VARS="Variables={AWS_ENDPOINT=http://host.docker.internal:4566,SNS_TOPIC_ARN=$TOPIC_ARN,PACKAGE_SERVICE_URL=$PACKAGE_URL,NODE_ENV=production}"

echo "1/4 IAM role: $ROLE (least privilege)"
if ! aws iam get-role --role-name $ROLE > /dev/null 2>&1; then
  aws iam create-role --role-name $ROLE \
    --assume-role-policy-document file://infra/iam/trust-policy.json > /dev/null || exit 1
fi
aws iam put-role-policy --role-name $ROLE --policy-name booking-request-access \
  --policy-document file://infra/iam/booking-policy.json || exit 1

echo "2/4 Lambda function: $FN (this can take a few minutes)"
npm run zip --silent || exit 1
if aws lambda get-function --function-name $FN > /dev/null 2>&1; then
  aws lambda update-function-code --function-name $FN --zip-file fileb://lambda.zip \
    --cli-read-timeout 300 > /dev/null
  aws lambda wait function-updated-v2 --function-name $FN
  aws lambda update-function-configuration --function-name $FN --handler src/lambda.handler \
    --timeout 15 --environment "$ENV_VARS" --cli-read-timeout 300 > /dev/null
  aws lambda wait function-updated-v2 --function-name $FN
else
  aws lambda create-function --function-name $FN --runtime nodejs24.x --handler src/lambda.handler \
    --role arn:aws:iam::$ACCOUNT:role/$ROLE --zip-file fileb://lambda.zip --timeout 15 \
    --environment "$ENV_VARS" --cli-read-timeout 300 > /dev/null
  aws lambda wait function-active-v2 --function-name $FN
fi
aws lambda get-function --function-name $FN --query "Configuration.State" --output text

echo "3/4 API Gateway: $API_NAME"
API_ID=$(aws apigatewayv2 get-apis --query "Items[?Name=='$API_NAME'].ApiId | [0]" --output text)
if [ -z "$API_ID" ] || [ "$API_ID" = "None" ]; then
  API_ID=$(aws apigatewayv2 create-api --name $API_NAME --protocol-type HTTP \
    --cors-configuration AllowOrigins="*",AllowMethods="GET,POST,PATCH,OPTIONS",AllowHeaders="Content-Type" \
    --query ApiId --output text)
  aws apigatewayv2 create-integration --api-id $API_ID \
    --integration-type AWS_PROXY --payload-format-version 2.0 \
    --integration-uri arn:aws:lambda:$REGION:$ACCOUNT:function:$FN > /dev/null
  aws apigatewayv2 create-stage --api-id $API_ID --stage-name '$default' --auto-deploy > /dev/null
else
  echo "   (API already exists)"
fi
INTEGRATION_ID=$(aws apigatewayv2 get-integrations --api-id $API_ID --query "Items[0].IntegrationId" --output text)
EXISTING_ROUTES=$(aws apigatewayv2 get-routes --api-id $API_ID --query "Items[].RouteKey" --output text)
for ROUTE in "GET /" "POST /bookings" "GET /bookings" "GET /bookings/{requestID}" \
             "PATCH /bookings/{requestID}/cancel" "PATCH /bookings/{requestID}/travelers" \
             "OPTIONS /bookings" "OPTIONS /bookings/{requestID}/cancel" "OPTIONS /bookings/{requestID}/travelers"; do
  if ! printf '%s\n' "$EXISTING_ROUTES" | tr -d '\r' | tr '\t' '\n' | grep -qxF "$ROUTE"; then
    aws apigatewayv2 create-route --api-id $API_ID --route-key "$ROUTE" \
      --target integrations/$INTEGRATION_ID > /dev/null && echo "   added route: $ROUTE"
  fi
done
API_URL=http://$API_ID.execute-api.localhost.floci.io:4566

echo "4/4 Permission: only this API may call the Lambda"
aws lambda add-permission --function-name $FN --statement-id apigw-invoke \
  --action lambda:InvokeFunction --principal apigateway.amazonaws.com \
  --source-arn "arn:aws:execute-api:$REGION:$ACCOUNT:$API_ID/*" > /dev/null 2>&1 \
  || echo "   (already allowed)"

echo ""
echo "Done. Your API:  $API_URL"
echo "Test it:        $API_URL/"
echo "Put this URL in Frontend/js/config.js as BOOKING_API_URL"
