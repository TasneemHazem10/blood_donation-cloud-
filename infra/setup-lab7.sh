#!/usr/bin/env bash
# Lab 7 style finish: publish the API Gateway routes and website, save the
# lab variables, then run the 13 BDO deployment checks.
#   bash infra/setup-lab7.sh
source "$(dirname "$0")/config.sh"

echo "== Checking Floci =="
curl -fsS "$FLOCI_URL/_floci/health" >/dev/null || { echo "Start Floci with bash infra/setup-all.sh first"; exit 1; }

cd "$ROOT" || exit 1
npm run zip:all
npm run workers:bundle

echo "== API Gateway and routes =="
bash "$ROOT/infra/gateway.sh"

echo "== Redeploy services with the API Gateway URL =="
bash "$ROOT/infra/services/drive.sh"
bash "$ROOT/infra/services/donor.sh"
bash "$ROOT/infra/services/booking.sh"

echo "== Publish website to S3 =="
bash "$ROOT/infra/frontend.sh"

echo "== Saved variables =="
bash "$ROOT/infra/lab7-vars.sh"

echo "== Deployment checks =="
bash "$ROOT/infra/check-lab7.sh"
