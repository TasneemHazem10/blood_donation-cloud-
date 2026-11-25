#!/usr/bin/env bash
# Lab 1/6 style base setup: verify the lab tools, start Floci, bundle the
# Lambda packages and deploy the three BDO services. Run in Git Bash.
#   bash infra/setup-all.sh
source "$(dirname "$0")/config.sh"

echo "== Tool versions =="
docker --version
aws --version
node --version
git --version
if command -v k6 >/dev/null 2>&1; then
  k6 version
elif [ -x "/c/Program Files/k6/k6.exe" ]; then
  echo "k6: C:/Program Files/k6/k6.exe (not on PATH; infra/scale-test.sh finds it automatically)"
else
  echo "k6: install with 'winget install k6 --source winget' for Lab 8"
fi

if [ -n "${AWS_PROFILE:-}" ]; then
  echo "AWS profile: $AWS_PROFILE"
  aws sts get-caller-identity --query Account --output text
fi

echo "== Starting Floci =="
curl -fsS "$FLOCI_URL/_floci/health" >/dev/null 2>&1 || \
  docker compose -f "$ROOT/infra/floci/docker-compose.yml" up -d
curl -fsS "$FLOCI_URL/_floci/health" >/dev/null
echo "Floci dashboard: $FLOCI_URL/_floci/ui"

echo "== Bundling Lambda packages (nodejs24.x / lambda.handler) =="
cd "$ROOT" || exit 1
npm run zip:all
npm run workers:bundle

echo "== Deploying DynamoDB tables, IAM roles, CloudWatch Logs and Lambdas =="
bash "$ROOT/infra/gateway.sh"
bash "$ROOT/infra/services/drive.sh"
bash "$ROOT/infra/services/donor.sh"
bash "$ROOT/infra/services/booking.sh"

echo "== Base deployment check =="
bash "$ROOT/infra/check.sh"
echo "Next lab step: bash infra/setup-lab7.sh"
