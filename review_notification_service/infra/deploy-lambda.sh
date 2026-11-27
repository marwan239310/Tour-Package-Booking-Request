#!/usr/bin/env bash
# Deploys the review & notification service to Floci in one command (safe to run again):
#   IAM role -> Lambda function -> API Gateway (7 routes) -> permission -> SNS subscription
# Before the first run:  bash infra/setup-aws.sh   and   bash infra/store-secret.sh
# Run from the service folder:  bash infra/deploy-lambda.sh
export AWS_PROFILE=floci AWS_PAGER="" MSYS_NO_PATHCONV=1
cd "$(dirname "$0")/.." || exit 1

REGION=us-east-1
ACCOUNT=000000000000
FN=review-notification-service
ROLE=review-notification-service-role
API_NAME=review-notification-api
TOPIC_ARN=arn:aws:sns:$REGION:$ACCOUNT:booking-status-topic

# Testing only: if .env has TEST_EMAIL_OVERRIDE, all emails go to that address
TEST_EMAIL=$(grep -E "^TEST_EMAIL_OVERRIDE=" .env 2>/dev/null | head -1 | cut -d= -f2- | tr -d '\r')
ENV_VARS="Variables={AWS_ENDPOINT=http://host.docker.internal:4566,SNS_TOPIC_ARN=$TOPIC_ARN,SECRET_ID=tour-booking/brevo,NODE_ENV=production"
[ -n "$TEST_EMAIL" ] && ENV_VARS="$ENV_VARS,TEST_EMAIL_OVERRIDE=$TEST_EMAIL"
ENV_VARS="$ENV_VARS}"

echo "1/5 IAM role: $ROLE (least privilege)"
if ! aws iam get-role --role-name $ROLE > /dev/null 2>&1; then
  aws iam create-role --role-name $ROLE \
    --assume-role-policy-document file://infra/iam/trust-policy.json > /dev/null || exit 1
fi
aws iam put-role-policy --role-name $ROLE --policy-name review-notification-access \
  --policy-document file://infra/iam/review-policy.json || exit 1

echo "2/5 Lambda function: $FN (this can take a few minutes)"
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

echo "3/5 API Gateway: $API_NAME"
API_ID=$(aws apigatewayv2 get-apis --query "Items[?Name=='$API_NAME'].ApiId | [0]" --output text)
if [ -z "$API_ID" ] || [ "$API_ID" = "None" ]; then
  API_ID=$(aws apigatewayv2 create-api --name $API_NAME --protocol-type HTTP --query ApiId --output text)
  INTEGRATION_ID=$(aws apigatewayv2 create-integration --api-id $API_ID \
    --integration-type AWS_PROXY --payload-format-version 2.0 \
    --integration-uri arn:aws:lambda:$REGION:$ACCOUNT:function:$FN \
    --query IntegrationId --output text)
  for ROUTE in "GET /" "GET /requests" "PATCH /requests/{requestID}/status" \
               "GET /requests/{requestID}/history" "POST /internal/sns-notify" \
               "OPTIONS /requests" "OPTIONS /requests/{requestID}/status"; do
    aws apigatewayv2 create-route --api-id $API_ID --route-key "$ROUTE" \
      --target integrations/$INTEGRATION_ID > /dev/null
  done
  aws apigatewayv2 create-stage --api-id $API_ID --stage-name '$default' --auto-deploy > /dev/null
else
  echo "   (already exists)"
fi
API_URL=http://$API_ID.execute-api.localhost.floci.io:4566

echo "4/5 Permission: only this API may call the Lambda"
aws lambda add-permission --function-name $FN --statement-id apigw-invoke \
  --action lambda:InvokeFunction --principal apigateway.amazonaws.com \
  --source-arn "arn:aws:execute-api:$REGION:$ACCOUNT:$API_ID/*" > /dev/null 2>&1 \
  || echo "   (already allowed)"

echo "5/5 SNS: deliver booking-status-topic to $API_URL/internal/sns-notify"
EXISTING=$(aws sns list-subscriptions-by-topic --topic-arn $TOPIC_ARN \
  --query "Subscriptions[?Endpoint=='$API_URL/internal/sns-notify'].SubscriptionArn | [0]" --output text)
if [ -z "$EXISTING" ] || [ "$EXISTING" = "None" ]; then
  aws sns subscribe --topic-arn $TOPIC_ARN --protocol http \
    --notification-endpoint "$API_URL/internal/sns-notify" > /dev/null
else
  echo "   (already subscribed)"
fi

echo ""
echo "Done. Your API:  $API_URL"
echo "Test it:        $API_URL/requests"