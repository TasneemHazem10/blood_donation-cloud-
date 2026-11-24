#!/usr/bin/env bash
# Removes the Floci resources created by this project. Does not delete .data or secrets.
source "$(dirname "$0")/config.sh"
load_state

for fn in bdo-drive-service bdo-donor-service bdo-booking-service; do
  aws_f lambda delete-function --function-name "$fn" >/dev/null 2>&1 || true
done
for role in bdo-drive-role bdo-donor-role bdo-booking-role; do
  aws_f iam delete-role --role-name "$role" >/dev/null 2>&1 || true
done
for table in bdo_drives bdo_slots bdo_reports bdo_users bdo_donors bdo_donations bdo_bookings bdo_reminders bdo_geocodes; do
  aws_f dynamodb delete-table --table-name "$table" >/dev/null 2>&1 || true
done
aws_f events delete-rule --name bdo-daily-reminders --force >/dev/null 2>&1 || true
aws_f s3 rb "s3://bdo-web" --force >/dev/null 2>&1 || true
aws_f s3 rb "s3://bdo-drive-reports" --force >/dev/null 2>&1 || true
aws_f logs delete-log-group --log-group-name /aws/lambda/bdo-drive-service >/dev/null 2>&1 || true
aws_f logs delete-log-group --log-group-name /aws/lambda/bdo-donor-service >/dev/null 2>&1 || true
aws_f logs delete-log-group --log-group-name /aws/lambda/bdo-booking-service >/dev/null 2>&1 || true
if [ -n "${API_ID:-}" ]; then aws_f apigatewayv2 delete-api --api-id "$API_ID" >/dev/null 2>&1 || true; fi
rm -f "$STATE_FILE"
echo "Floci resources removed."
