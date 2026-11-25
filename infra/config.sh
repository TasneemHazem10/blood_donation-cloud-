#!/usr/bin/env bash
# Shared settings for every Floci script. Run these scripts in Git Bash.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FLOCI_URL="${FLOCI_URL:-http://localhost:4566}"
# Inside a Lambda container, localhost points at the Lambda itself. Docker's
# embedded DNS resolves the compose service name "floci" to the emulator.
AWS_ENDPOINT_LAMBDA="${AWS_ENDPOINT_LAMBDA:-http://floci:4566}"
AWS_REGION="${AWS_REGION:-us-east-1}"
AWS_ACCOUNT="${AWS_ACCOUNT:-000000000000}"
STATE_FILE="$ROOT/infra/.state"
SECRETS_FILE="$ROOT/infra/secrets.env"

export AWS_DEFAULT_REGION="$AWS_REGION"
export AWS_PAGER=""
# The labs configure a reusable `floci` AWS CLI profile. When it is present we
# honour it; otherwise the same dummy credentials are exported for CI.
export MSYS_NO_PATHCONV=1
# The labs create a reusable `floci` profile. Use it automatically when it
# exists so `aws sts get-caller-identity` works exactly as in the lab notes.
if [ -z "${AWS_PROFILE:-}" ] && aws configure get aws_access_key_id --profile floci >/dev/null 2>&1; then
  export AWS_PROFILE=floci
fi
if [ -n "${AWS_PROFILE:-}" ]; then
  aws_f() { aws "$@"; }
else
  export AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID:-test}"
  export AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY:-test}"
  aws_f() { aws --endpoint-url "$FLOCI_URL" "$@"; }
fi

# AWS CLI expects spaces in file:// paths to be percent-encoded.
file_url() { printf 'file://%s' "$(printf '%s' "$1" | sed 's/ /%20/g')"; }

load_state() { if [ -f "$STATE_FILE" ]; then # shellcheck disable=SC1090
  source "$STATE_FILE"; fi; }
save_state() {
  {
    echo "API_ID=${API_ID:-}"
    echo "API_URL=${API_URL:-}"
    echo "DRIVE_INTEGRATION=${DRIVE_INTEGRATION:-}"
    echo "DONOR_INTEGRATION=${DONOR_INTEGRATION:-}"
    echo "BOOKING_INTEGRATION=${BOOKING_INTEGRATION:-}"
  } > "$STATE_FILE"
}

ensure_secrets() {
  if [ ! -f "$SECRETS_FILE" ]; then
    local jwt internal invite
    jwt="$(node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))")"
    internal="$(node -e "process.stdout.write(require('crypto').randomBytes(24).toString('hex'))")"
    invite="blood-$(node -e "process.stdout.write(require('crypto').randomBytes(3).toString('hex'))")"
    cat > "$SECRETS_FILE" <<EOF
# Generated automatically. Never commit this file.
JWT_SECRET=$jwt
INTERNAL_KEY=$internal
ORGANIZER_INVITE=$invite
EOF
    chmod 600 "$SECRETS_FILE" || true
    echo "Created infra/secrets.env (organizer invite: $invite)"
  fi
  # shellcheck disable=SC1090
  source "$SECRETS_FILE"
}

role_arn() { echo "arn:aws:iam::$AWS_ACCOUNT:role/$1"; }
lambda_arn() { echo "arn:aws:lambda:$AWS_REGION:$AWS_ACCOUNT:function:$1"; }

# Stop a local dev-all process and its three Express children. On Windows the
# Git Bash `kill` builtin does not terminate the child tree reliably, so use
# taskkill when available.
kill_tree() {
  local pid="$1" winpid=""
  if command -v taskkill >/dev/null 2>&1; then
    # Git Bash PIDs are not Windows PIDs. ps -W maps the saved MSYS PID to
    # WINPID (column 4), which is what taskkill needs.
    winpid="$(ps -W 2>/dev/null | awk -v p="$pid" '$1 == p { print $4; exit }')"
    if [ -n "$winpid" ]; then
      cmd.exe /c "taskkill /PID $winpid /T /F >nul 2>&1" >/dev/null 2>&1 || true
    fi
  fi
  kill -TERM "$pid" >/dev/null 2>&1 || true
}
