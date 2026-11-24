#!/usr/bin/env bash
# Evidence-friendly deployment check. Prints PASS/FAIL for every layer.
source "$(dirname "$0")/config.sh"
load_state
FAILED=0

check() {
  local label="$1" url="$2"
  local code
  code="$(curl -s -o /dev/null -w '%{http_code}' "$url" || true)"
  if [ "$code" = "200" ] || [ "$code" = "204" ]; then echo "PASS  $label ($code)"; else echo "FAIL  $label ($code)"; FAILED=$((FAILED+1)); fi
}

echo "API Gateway: ${API_URL:-not deployed}"
check "Drive health"  "${API_URL:-http://localhost:4566}/api/health/drive"
check "Donor health"  "${API_URL:-http://localhost:4566}/api/health/donor"
check "Booking health" "${API_URL:-http://localhost:4566}/api/health/booking"
check "Drive list"    "${API_URL:-http://localhost:4566}/api/drives"
check "Website file"  "$FLOCI_URL/bdo-web/index.html"
check "Floci dashboard" "$FLOCI_URL/_floci/ui"

echo "DynamoDB tables:"
aws_f dynamodb list-tables --query TableNames --output text 2>/dev/null || echo "none"
echo "Lambda functions:"
aws_f lambda list-functions --query Functions[].FunctionName --output text 2>/dev/null || echo "none"
echo "S3 buckets:"
aws_f s3api list-buckets --query Buckets[].Name --output text 2>/dev/null || echo "none"

if [ "$FAILED" -eq 0 ]; then echo "ALL CHECKS PASSED"; else echo "$FAILED CHECK(S) FAILED"; fi
exit "$FAILED"
