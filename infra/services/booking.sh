#!/usr/bin/env bash
# Student 3 - Booking and Reminder: DynamoDB, IAM, Lambda, CloudWatch, EventBridge.
source "$(dirname "$0")/../config.sh"
load_state
ensure_secrets
# Use a relative fileb:// path from the project root (see drive.sh).
cd "$ROOT" || exit 1

for table in bdo_bookings bdo_reminders; do
  if ! aws_f dynamodb describe-table --table-name "$table" >/dev/null 2>&1; then
    aws_f dynamodb create-table --table-name "$table" \
      --attribute-definitions AttributeName=id,AttributeType=S \
      --key-schema AttributeName=id,KeyType=HASH \
      --billing-mode PAY_PER_REQUEST >/dev/null
  fi
done

aws_f iam create-role --role-name bdo-booking-role \
  --assume-role-policy-document "$(cat "$ROOT/infra/iam/trust-policy.json")" >/dev/null 2>&1 || true
aws_f iam put-role-policy --role-name bdo-booking-role --policy-name bdo-booking-access \
  --policy-document "$(cat "$ROOT/infra/iam/booking-policy.json")" >/dev/null

aws_f logs create-log-group --log-group-name /aws/lambda/bdo-booking-service >/dev/null 2>&1 || true

ENV_VARS="Variables={DATA_DRIVER=dynamo,AWS_ENDPOINT_URL=$AWS_ENDPOINT_LAMBDA,JWT_SECRET=$JWT_SECRET,INTERNAL_KEY=$INTERNAL_KEY,ORGANIZER_INVITE=$ORGANIZER_INVITE,DRIVE_SERVICE_URL=$API_URL,DONOR_SERVICE_URL=$API_URL,BOOKING_SERVICE_URL=$API_URL,CORS_ORIGINS=http://localhost:4566,EMAIL_MODE=${EMAIL_MODE:-log},BREVO_API_KEY=${BREVO_API_KEY:-},NODE_ENV=production}"

if aws_f lambda get-function --function-name bdo-booking-service >/dev/null 2>&1; then
  aws_f lambda update-function-code --function-name bdo-booking-service \
    --zip-file "fileb://dist/lambda/booking.zip" >/dev/null
  aws_f lambda update-function-configuration --function-name bdo-booking-service \
    --handler index.handler --timeout 20 --environment "$ENV_VARS" >/dev/null
else
  aws_f lambda create-function --function-name bdo-booking-service \
    --runtime nodejs22.x --handler index.handler --timeout 20 \
    --role "$(role_arn bdo-booking-role)" \
    --zip-file "fileb://dist/lambda/booking.zip" \
    --environment "$ENV_VARS" >/dev/null
fi

# Daily 06:00 UTC job that POSTs to /internal/reminders/daily with the shared key.
if aws_f events put-rule --name bdo-daily-reminders \
    --schedule-expression 'cron(0 6 * * ? *)' --state ENABLED >/dev/null 2>&1; then
  aws_f lambda add-permission --function-name bdo-booking-service \
    --statement-id bdo-eventbridge-invoke --action lambda:InvokeFunction \
    --principal events.amazonaws.com \
    --source-arn "arn:aws:events:$AWS_REGION:$AWS_ACCOUNT:rule/bdo-daily-reminders" >/dev/null 2>&1 || true
  aws_f events put-targets --rule bdo-daily-reminders \
    --targets "[{\"Id\":\"bdo-reminder-target\",\"Arn\":\"$(lambda_arn bdo-booking-service)\"}]" >/dev/null 2>&1 || true
else
  echo "WARN: Floci did not accept the EventBridge rule; use the Organizer > Emails button."
fi
echo "Student 3 deployed: Lambda bdo-booking-service (DynamoDB + IAM + CloudWatch Logs + EventBridge)"
