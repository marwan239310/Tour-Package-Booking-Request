#!/usr/bin/env bash
# Makes sure the DynamoDB tables and SNS topic the booking service uses exist in Floci (safe to run again).
# The review service's setup script creates the same tables; this one only adds what is missing.
# Run from the booking_service folder:  bash infra/setup-aws.sh
export AWS_PROFILE=floci AWS_PAGER="" MSYS_NO_PATHCONV=1

echo "1/3 DynamoDB table: BookingRequests (key: requestID)"
aws dynamodb create-table --table-name BookingRequests \
  --attribute-definitions AttributeName=requestID,AttributeType=S \
  --key-schema AttributeName=requestID,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST > /dev/null 2>&1 || echo "   (already exists)"

echo "2/3 DynamoDB table: StatusHistory (keys: requestID + changedAt)"
aws dynamodb create-table --table-name StatusHistory \
  --attribute-definitions AttributeName=requestID,AttributeType=S AttributeName=changedAt,AttributeType=S \
  --key-schema AttributeName=requestID,KeyType=HASH AttributeName=changedAt,KeyType=RANGE \
  --billing-mode PAY_PER_REQUEST > /dev/null 2>&1 || echo "   (already exists)"

echo "3/3 SNS topic: booking-status-topic"
aws sns create-topic --name booking-status-topic --query TopicArn --output text

echo "Done. Tables now:"
aws dynamodb list-tables --output text
