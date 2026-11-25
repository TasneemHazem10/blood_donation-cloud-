#!/usr/bin/env bash
# Lab 8 style app runner. BDO's "10 services" equivalent is the local stack:
# three Express APIs plus the static website, with Floci providing the AWS
# emulator behind the deployed Lambdas.
#   bash infra/run-floci.sh          # start
#   bash infra/run-floci.sh stop     # stop
#   bash infra/run-floci.sh status   # probe
source "$(dirname "$0")/config.sh"

PID_FILE="$ROOT/.data/run/bdo-app.pid"
REPLICA_PID_FILE="$ROOT/.data/run/bdo-replica-0.pid"
LOG_FILE="$ROOT/.data/run/bdo-app.log"
DRIVE="${BDO_DRIVE_URL:-http://localhost:3001}"

is_running() { curl -fsS --max-time 3 "$DRIVE/api/health/drive" >/dev/null 2>&1; }

start() {
  if is_running; then echo "BDO local stack is already running: $DRIVE"; return 0; fi
  mkdir -p "$(dirname "$PID_FILE")"
  cd "$ROOT" || exit 1
  # Launch node directly so $! is the real Node PID (nohup.exe would be an
  # extra wrapper process and taskkill /T would miss the Node children).
  node infra/scripts/dev-all.js > "$LOG_FILE" 2>&1 &
  echo "$!" > "$PID_FILE"
  echo "$!" > "$REPLICA_PID_FILE"
  for _ in $(seq 1 30); do
    is_running && { echo "BDO local stack started (PID $(cat "$PID_FILE"))"; return 0; }
    sleep 1
  done
  echo "BDO local stack did not become healthy. See $LOG_FILE"; return 1
}

stop() {
  if [ ! -f "$PID_FILE" ]; then echo "No saved PID file"; return 0; fi
  local pid
  pid="$(cat "$PID_FILE")"
  if kill -0 "$pid" >/dev/null 2>&1; then
    kill -INT "$pid" 2>/dev/null || true
    for _ in $(seq 1 5); do kill -0 "$pid" >/dev/null 2>&1 || break; sleep 1; done
    kill_tree "$pid"
  fi
  rm -f "$PID_FILE" "$REPLICA_PID_FILE"
  echo "BDO local stack stopped"
}

status() {
  for url in \
    "$DRIVE/api/health/drive" \
    "${BDO_DONOR_URL:-http://localhost:3002}/api/health/donor" \
    "${BDO_BOOKING_URL:-http://localhost:3003}/api/health/booking" \
    "${BDO_WEB_URL:-http://localhost:8090}/"; do
    local code
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "$url" || true)"
    echo "$code  $url"
  done
}

case "${1:-start}" in
  start)   start ;;
  stop)    stop ;;
  restart) stop; start ;;
  status)  status ;;
  *) echo "Usage: $0 {start|stop|restart|status}"; exit 2 ;;
esac
