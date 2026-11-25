#!/usr/bin/env bash
# Student 1 - Drive Management: DynamoDB tables, S3 reports, IAM, Lambda, CloudWatch.
source "$(dirname "$0")/../config.sh"
load_state
ensure_secrets
# The AWS CLI resolves fileb:// paths against the process working directory.
# cd to the space-free-independent project root and use a relative path so
# Windows paths containing spaces are not parsed by botocore as part of the URI.
cd "$ROOT" || exit 1

for table in bdo_drives bdo_slots bdo_reports bdo_geocodes; do
  if ! aws_f dynamodb describe-table --table-name "$table" >/dev/null 2>&1; then
    aws_f dynamodb create-table --table-name "$table" \
      --attribute-definitions AttributeName=id,AttributeType=S \
      --key-schema AttributeName=id,KeyType=HASH \
      --billing-mode PAY_PER_REQUEST >/dev/null
  fi
done

aws_f s3 mb "s3://bdo-drive-reports" >/dev/null 2>&1 || true

aws_f iam create-role --role-name bdo-drive-role \
  --assume-role-policy-document "$(cat "$ROOT/infra/iam/trust-policy.json")" >/dev/null 2>&1 || true
aws_f iam put-role-policy --role-name bdo-drive-role --policy-name bdo-drive-access \
  --policy-document "$(cat "$ROOT/infra/iam/drive-policy.json")" >/dev/null

aws_f logs create-log-group --log-group-name /aws/lambda/bdo-drive-service >/dev/null 2>&1 || true

ENV_VARS="Variables={DATA_DRIVER=dynamo,AWS_ENDPOINT_URL=$AWS_ENDPOINT_LAMBDA,JWT_SECRET=$JWT_SECRET,INTERNAL_KEY=$INTERNAL_KEY,ORGANIZER_INVITE=$ORGANIZER_INVITE,DRIVE_SERVICE_URL=$API_URL,DONOR_SERVICE_URL=$API_URL,BOOKING_SERVICE_URL=$API_URL,CORS_ORIGINS=http://localhost:4566,REPORTS_BUCKET=bdo-drive-reports,NODE_ENV=production}"

if aws_f lambda get-function --function-name bdo-drive-service >/dev/null 2>&1; then
  aws_f lambda update-function-code --function-name bdo-drive-service \
    --zip-file "fileb://dist/lambda/drive.zip" >/dev/null
  aws_f lambda update-function-configuration --function-name bdo-drive-service \
    --runtime nodejs24.x --handler lambda.handler --timeout 20 --environment "$ENV_VARS" >/dev/null
else
  aws_f lambda create-function --function-name bdo-drive-service \
    --runtime nodejs24.x --handler lambda.handler --timeout 20 \
    --role "$(role_arn bdo-drive-role)" \
    --zip-file "fileb://dist/lambda/drive.zip" \
    --environment "$ENV_VARS" >/dev/null
fi
echo "Student 1 deployed: Lambda bdo-drive-service (DynamoDB + S3 + IAM + CloudWatch Logs)"
