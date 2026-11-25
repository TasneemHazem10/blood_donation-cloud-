#!/usr/bin/env bash
# Student 2 - Donor and Eligibility: DynamoDB tables, IAM, Lambda, CloudWatch.
source "$(dirname "$0")/../config.sh"
load_state
ensure_secrets
# Use a relative fileb:// path from the project root (see drive.sh).
cd "$ROOT" || exit 1

for table in bdo_users bdo_donors bdo_donations; do
  if ! aws_f dynamodb describe-table --table-name "$table" >/dev/null 2>&1; then
    aws_f dynamodb create-table --table-name "$table" \
      --attribute-definitions AttributeName=id,AttributeType=S \
      --key-schema AttributeName=id,KeyType=HASH \
      --billing-mode PAY_PER_REQUEST >/dev/null
  fi
done

aws_f iam create-role --role-name bdo-donor-role \
  --assume-role-policy-document "$(cat "$ROOT/infra/iam/trust-policy.json")" >/dev/null 2>&1 || true
aws_f iam put-role-policy --role-name bdo-donor-role --policy-name bdo-donor-access \
  --policy-document "$(cat "$ROOT/infra/iam/donor-policy.json")" >/dev/null

aws_f logs create-log-group --log-group-name /aws/lambda/bdo-donor-service >/dev/null 2>&1 || true

ENV_VARS="Variables={DATA_DRIVER=dynamo,AWS_ENDPOINT_URL=$AWS_ENDPOINT_LAMBDA,JWT_SECRET=$JWT_SECRET,INTERNAL_KEY=$INTERNAL_KEY,ORGANIZER_INVITE=$ORGANIZER_INVITE,DRIVE_SERVICE_URL=$API_URL,DONOR_SERVICE_URL=$API_URL,BOOKING_SERVICE_URL=$API_URL,CORS_ORIGINS=http://localhost:4566,TURNSTILE_SECRET=${TURNSTILE_SECRET:-},NODE_ENV=production}"

if aws_f lambda get-function --function-name bdo-donor-service >/dev/null 2>&1; then
  aws_f lambda update-function-code --function-name bdo-donor-service \
    --zip-file "fileb://dist/lambda/donor.zip" >/dev/null
  aws_f lambda update-function-configuration --function-name bdo-donor-service \
    --runtime nodejs24.x --handler lambda.handler --timeout 20 --environment "$ENV_VARS" >/dev/null
else
  aws_f lambda create-function --function-name bdo-donor-service \
    --runtime nodejs24.x --handler lambda.handler --timeout 20 \
    --role "$(role_arn bdo-donor-role)" \
    --zip-file "fileb://dist/lambda/donor.zip" \
    --environment "$ENV_VARS" >/dev/null
fi
echo "Student 2 deployed: Lambda bdo-donor-service (DynamoDB + IAM + CloudWatch Logs)"
