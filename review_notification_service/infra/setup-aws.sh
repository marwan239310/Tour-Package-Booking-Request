#!/usr/bin/env bash
# Creates everything the review & notification service needs in Floci (safe to run again).
# Run from the project folder:  bash review_notification_service/infra/setup-aws.sh
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

echo "   Adding the 4 sample booking requests"
aws dynamodb put-item --table-name BookingRequests --item '{"requestID":{"S":"REQ-1"},"packageID":{"S":"PKG-1"},"customerName":{"S":"Sara Ali"},"customerEmail":{"S":"sara@example.com"},"travelers":{"N":"2"},"status":{"S":"pending"},"createdAt":{"S":"2026-11-20"}}'
aws dynamodb put-item --table-name BookingRequests --item '{"requestID":{"S":"REQ-2"},"packageID":{"S":"PKG-1"},"customerName":{"S":"Omar Hassan"},"customerEmail":{"S":"omar@example.com"},"travelers":{"N":"4"},"status":{"S":"under_review"},"createdAt":{"S":"2026-11-21"}}'
aws dynamodb put-item --table-name BookingRequests --item '{"requestID":{"S":"REQ-3"},"packageID":{"S":"PKG-2"},"customerName":{"S":"Mona Adel"},"customerEmail":{"S":"mona@example.com"},"travelers":{"N":"1"},"status":{"S":"confirmed"},"createdAt":{"S":"2026-11-21"}}'
aws dynamodb put-item --table-name BookingRequests --item '{"requestID":{"S":"REQ-4"},"packageID":{"S":"PKG-3"},"customerName":{"S":"Youssef Nabil"},"customerEmail":{"S":"youssef@example.com"},"travelers":{"N":"3"},"status":{"S":"rejected"},"createdAt":{"S":"2026-11-22"}}'

echo "3/3 SNS topic: booking-status-topic"
aws sns create-topic --name booking-status-topic --query TopicArn --output text

echo "Done. Tables now:"
aws dynamodb list-tables --output text