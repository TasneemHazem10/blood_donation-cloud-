#!/usr/bin/env bash
# Lab 7 style deployment evidence for the Blood Donation Drive Organizer.
# It checks the same layers as the lab: account, emulator, API Gateway,
# three Lambdas, DynamoDB, S3 and the published website.
#   bash infra/check-lab7.sh
source "$(dirname "$0")/config.sh"
load_state

PASS=0
FAIL=0

check() {
  local label="$1"; shift
  if "$@"; then
    echo "PASS  $label"
    PASS=$((PASS + 1))
  else
    echo "FAIL  $label"
    FAIL=$((FAIL + 1))
  fi
}

equals() { [ "$1" = "$2" ]; }
nonempty() { [ -n "$1" ] && [ "$1" != "None" ]; }
http_ok() {
  local code
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$1" 2>/dev/null || true)"
  [ "$code" = "200" ] || [ "$code" = "204" ]
}
table_active() {
  local status
  status="$(aws_f dynamodb describe-table --table-name "$1" --query Table.TableStatus --output text 2>/dev/null || true)"
  [ "$status" = "ACTIVE" ]
}
lambda_active() {
  local state
  state="$(aws_f lambda get-function --function-name "$1" --query Configuration.State --output text 2>/dev/null || true)"
  [ "$state" = "Active" ]
}
bucket_exists() { aws_f s3api head-bucket --bucket "$1" >/dev/null 2>&1; }
api_exists() { aws_f apigatewayv2 get-api --api-id "$1" >/dev/null 2>&1; }

account="$(aws_f sts get-caller-identity --query Account --output text 2>/dev/null || true)"

echo "== Lab 7 BDO deployment checks =="
echo "API Gateway: ${API_URL:-not deployed}"
check "01 AWS floci profile account 000000000000" equals "$account" "000000000000"
check "02 Floci health endpoint" http_ok "$FLOCI_URL/_floci/health"
check "03 Floci dashboard" http_ok "$FLOCI_URL/_floci/ui"
check "04 API Gateway exists" nonempty "${API_ID:-}"
check "05 API Gateway exists in AWS" api_exists "${API_ID:-none}"
check "06 Drive health through API Gateway" http_ok "${API_URL:-$FLOCI_URL}/api/health/drive"
check "07 Donor health through API Gateway" http_ok "${API_URL:-$FLOCI_URL}/api/health/donor"
check "08 Booking health through API Gateway" http_ok "${API_URL:-$FLOCI_URL}/api/health/booking"
check "09 Website index.html on S3" http_ok "$FLOCI_URL/bdo-web/index.html"
check "10 DynamoDB bdo_drives is ACTIVE" table_active bdo_drives
check "11 Lambda bdo-drive-service is Active" lambda_active bdo-drive-service
check "12 Lambda bdo-donor-service is Active" lambda_active bdo-donor-service
check "13 S3 bucket bdo-web exists" bucket_exists bdo-web

echo "Result: $PASS passed, $FAIL failed"
exit "$FAIL"
