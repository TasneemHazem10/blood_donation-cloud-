#!/usr/bin/env bash
# One API Gateway HTTP API is the front door for all three services (Student 1 leads).
source "$(dirname "$0")/config.sh"
load_state
ensure_secrets

if [ -z "${API_ID:-}" ] || [ "$(aws_f apigatewayv2 get-api --api-id "$API_ID" >/dev/null 2>&1; echo $?)" != "0" ]; then
  API_ID="$(aws_f apigatewayv2 create-api --name bdo-http-api --protocol-type HTTP --query ApiId --output text)"
  API_URL="http://$API_ID.execute-api.localhost.floci.io:4566"
fi

if [ -z "${DRIVE_INTEGRATION:-}" ]; then
  DRIVE_INTEGRATION="$(aws_f apigatewayv2 create-integration --api-id "$API_ID" --integration-type AWS_PROXY \
    --payload-format-version 2.0 --integration-uri "$(lambda_arn bdo-drive-service)" --query IntegrationId --output text)"
fi
if [ -z "${DONOR_INTEGRATION:-}" ]; then
  DONOR_INTEGRATION="$(aws_f apigatewayv2 create-integration --api-id "$API_ID" --integration-type AWS_PROXY \
    --payload-format-version 2.0 --integration-uri "$(lambda_arn bdo-donor-service)" --query IntegrationId --output text)"
fi
if [ -z "${BOOKING_INTEGRATION:-}" ]; then
  BOOKING_INTEGRATION="$(aws_f apigatewayv2 create-integration --api-id "$API_ID" --integration-type AWS_PROXY \
    --payload-format-version 2.0 --integration-uri "$(lambda_arn bdo-booking-service)" --query IntegrationId --output text)"
fi
save_state

add_route() {
  local route="$1" integration="$2" id
  id="$(aws_f apigatewayv2 get-routes --api-id "$API_ID" --query "Items[?RouteKey=='$route'].RouteId | [0]" --output text 2>/dev/null || true)"
  if [ -z "$id" ] || [ "$id" = "None" ]; then
    aws_f apigatewayv2 create-route --api-id "$API_ID" --route-key "$route" \
      --target "integrations/$integration" --query RouteKey --output text >/dev/null
  fi
}

DRIVE_ROUTES=(
  'GET /api/health/drive' 'GET /api/drives' 'POST /api/drives' 'GET /api/drives/{id}'
  'PUT /api/drives/{id}' 'PATCH /api/drives/{id}/status' 'DELETE /api/drives/{id}'
  'POST /api/drives/{id}/slots' 'PUT /api/drives/{id}/slots/{slotId}' 'DELETE /api/drives/{id}/slots/{slotId}'
  'GET /api/drives/{id}/report' 'GET /api/drives/{id}/reports'
  'GET /internal/drives/{id}' 'POST /internal/drives/{id}/slots/{slotId}/reservation'
  'DELETE /internal/drives/{id}/slots/{slotId}/reservation'
)
DONOR_ROUTES=(
  'GET /api/health/donor' 'POST /api/auth/register' 'POST /api/auth/login' 'GET /api/auth/me'
  'GET /api/donors/me' 'PUT /api/donors/me' 'DELETE /api/donors/me'
  'GET /api/donors/me/eligibility' 'GET /api/donors/me/donations'
  'GET /internal/donors/{id}/eligibility' 'POST /internal/donations' 'GET /internal/donors/{id}'
)
BOOKING_ROUTES=(
  'GET /api/health/booking' 'POST /api/bookings' 'GET /api/bookings' 'GET /api/bookings/mine'
  'POST /api/bookings/{id}/cancel' 'PATCH /api/bookings/{id}/check-in'
  'POST /api/reminders/send' 'GET /api/reminders'
  'GET /internal/drives/{id}/stats' 'POST /internal/drives/{id}/cancellations'
  'GET /internal/donors/{id}/active-bookings' 'POST /internal/reminders/daily'
)

for route in "${DRIVE_ROUTES[@]}"; do add_route "$route" "$DRIVE_INTEGRATION"; done
for route in "${DONOR_ROUTES[@]}"; do add_route "$route" "$DONOR_INTEGRATION"; done
for route in "${BOOKING_ROUTES[@]}"; do add_route "$route" "$BOOKING_INTEGRATION"; done

# Browser preflight is answered by the Express CORS middleware in any service.
add_route 'OPTIONS /api/{proxy+}' "$DRIVE_INTEGRATION"
add_route 'OPTIONS /internal/{proxy+}' "$DRIVE_INTEGRATION"

aws_f apigatewayv2 create-stage --api-id "$API_ID" --stage-name '$default' --auto-deploy >/dev/null 2>&1 || true
echo "API Gateway ready: $API_URL"
