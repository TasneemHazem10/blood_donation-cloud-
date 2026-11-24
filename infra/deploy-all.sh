#!/usr/bin/env bash
# Full Floci deployment. Run in Git Bash from the project root.
source "$(dirname "$0")/config.sh"

echo "==> Checking Floci"
curl -fsS "$FLOCI_URL/_floci/health" >/dev/null 2>&1 || { echo "Floci is not running. Start Docker Desktop and: docker compose -f infra/floci/docker-compose.yml up -d"; exit 1; }

echo "==> Bundling Lambda and Worker packages"
npm run zip:all
npm run workers:bundle

echo "==> API Gateway"
bash "$ROOT/infra/gateway.sh"

echo "==> Student 1: Drive Management"
bash "$ROOT/infra/services/drive.sh"

echo "==> Student 2: Donor and Eligibility"
bash "$ROOT/infra/services/donor.sh"

echo "==> Student 3: Booking and Reminder"
bash "$ROOT/infra/services/booking.sh"

echo "==> Website on S3"
bash "$ROOT/infra/frontend.sh"

echo "==> Verification"
bash "$ROOT/infra/check.sh"
