#!/usr/bin/env bash
# Lab 8 style scale/security evidence for the Blood Donation Drive Organizer.
# Run `bash infra/run-floci.sh` first so the local stack is listening on
# 8090/3001/3002/3003, then run this script.
#   bash infra/check-lab8.sh
source "$(dirname "$0")/config.sh"
load_state

BASE_DRIVE="${BDO_DRIVE_URL:-http://localhost:3001}"
BASE_DONOR="${BDO_DONOR_URL:-http://localhost:3002}"
BASE_BOOKING="${BDO_BOOKING_URL:-http://localhost:3003}"
WEB="${BDO_WEB_URL:-http://localhost:8090}"

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
http_ok() {
  local code
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$1" 2>/dev/null || true)"
  [ "$code" = "200" ] || [ "$code" = "204" ]
}
status_is() {
  local expected="$1"; shift
  local code
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$@" 2>/dev/null || true)"
  [ "$code" = "$expected" ]
}
header_has() {
  curl -sI --max-time 10 "$1" 2>/dev/null | tr -d '\r' | grep -qiF "$2"
}
cors_ok() {
  # OPTIONS responses have no body, so there is no need for -o /dev/null
  # (which returns curl write error 23 under some Git Bash builds).
  curl -s -D - --max-time 10 -X OPTIONS \
    -H 'Origin: http://localhost:8090' -H 'Access-Control-Request-Method: GET' \
    "$BASE_DRIVE/api/drives" 2>/dev/null | tr -d '\r' \
    | grep -qiE '^access-control-allow-origin: http://localhost:8090'
}
malformed_json_is_400() {
  status_is 400 "$BASE_DRIVE/api/drives" -X POST -H 'Content-Type: application/json' --data '{'
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
log_group_exists() { aws_f logs describe-log-groups --log-group-name-prefix "$1" --query 'logGroups[0].logGroupName' --output text 2>/dev/null | grep -q "$1"; }
bucket_exists() { aws_f s3api head-bucket --bucket "$1" >/dev/null 2>&1; }
api_exists() { aws_f apigatewayv2 get-api --api-id "$1" >/dev/null 2>&1; }

account="$(aws_f sts get-caller-identity --query Account --output text 2>/dev/null || true)"

echo "== Lab 8 BDO infrastructure checks =="
check "01 AWS floci profile account 000000000000" equals "$account" "000000000000"
check "02 Floci health endpoint" http_ok "$FLOCI_URL/_floci/health"
check "03 Floci dashboard" http_ok "$FLOCI_URL/_floci/ui"
check "04 API Gateway exists" api_exists "${API_ID:-none}"
check "05 Lambda bdo-drive-service is Active" lambda_active bdo-drive-service
check "06 Lambda bdo-donor-service is Active" lambda_active bdo-donor-service
check "07 Lambda bdo-booking-service is Active" lambda_active bdo-booking-service
check "08 DynamoDB bdo_drives is ACTIVE" table_active bdo_drives
check "09 S3 bucket bdo-web exists" bucket_exists bdo-web
check "10 CloudWatch log group exists" log_group_exists /aws/lambda/bdo-

echo "== Lab 8 BDO local app and security checks =="
check "11 Website on port 8090" http_ok "$WEB/"
check "12 Drive health on port 3001" http_ok "$BASE_DRIVE/api/health/drive"
check "13 Donor health on port 3002" http_ok "$BASE_DONOR/api/health/donor"
check "14 Booking health on port 3003" http_ok "$BASE_BOOKING/api/health/booking"
check "15 Drive list returns 200" http_ok "$BASE_DRIVE/api/drives"
check "16 X-Content-Type-Options: nosniff" header_has "$BASE_DRIVE/api/drives" 'X-Content-Type-Options: nosniff'
check "17 X-Frame-Options: DENY" header_has "$BASE_DRIVE/api/drives" 'X-Frame-Options: DENY'
check "18 Content-Security-Policy present" header_has "$BASE_DRIVE/api/drives" 'Content-Security-Policy:'
check "19 Referrer-Policy present" header_has "$BASE_DRIVE/api/drives" 'Referrer-Policy:'
check "20 Permissions-Policy present" header_has "$BASE_DRIVE/api/drives" 'Permissions-Policy:'
check "21 CORS preflight allows local website" cors_ok
check "22 Malformed JSON returns 400" malformed_json_is_400

echo "Result: $PASS passed, $FAIL failed"
exit "$FAIL"
