#!/usr/bin/env bash
# Lab 8 style scaling helper for BDO.
#   bash infra/scale-test.sh vertical
#   bash infra/scale-test.sh horizontal 3
#   bash infra/scale-test.sh kill 2
#   bash infra/scale-test.sh stop
#   bash infra/scale-test.sh load
#
# "vertical" uses the single local stack; "horizontal N" starts N independent
# local Node stacks on separate ports. This is an honest local analogue of the
# lab's ECS replica exercise, not a claim of production auto scaling.
source "$(dirname "$0")/config.sh"

RUN_DIR="$ROOT/.data/run"
mkdir -p "$RUN_DIR"

pid_file() { echo "$RUN_DIR/bdo-replica-$1.pid"; }
log_file() { echo "$RUN_DIR/bdo-replica-$1.log"; }
drive_url() { echo "http://localhost:$((3001 + $1 * 100))"; }

healthy() { curl -fsS --max-time 3 "$(drive_url "$1")/api/health/drive" >/dev/null 2>&1; }

start_replica() {
  local index="$1"
  if healthy "$index"; then echo "Replica $index already healthy: $(drive_url "$index")"; return 0; fi
  cd "$ROOT" || exit 1
  # Launch node directly so the saved PID is the Node process itself, not a
  # nohup.exe wrapper. taskkill /T can then stop the whole Express child tree.
  BDO_REPLICA="$index" RATE_LIMIT_MAX="${RATE_LIMIT_MAX:-100000}" \
    node infra/scripts/dev-all.js > "$(log_file "$index")" 2>&1 &
  echo "$!" > "$(pid_file "$index")"
  for _ in $(seq 1 30); do
    healthy "$index" && { echo "Replica $index started: $(drive_url "$index")"; return 0; }
    sleep 1
  done
  echo "Replica $index failed to start. See $(log_file "$index")"; return 1
}

stop_replica() {
  local index="$1" file pid
  file="$(pid_file "$index")"
  [ -f "$file" ] || return 0
  pid="$(cat "$file")"
  if kill -0 "$pid" >/dev/null 2>&1; then
    kill -INT "$pid" 2>/dev/null || true
    for _ in $(seq 1 5); do kill -0 "$pid" >/dev/null 2>&1 || break; sleep 1; done
    kill_tree "$pid"
  fi
  rm -f "$file"
  echo "Replica $index stopped"
}

k6_bin() {
  if [ -n "${K6_BIN:-}" ]; then echo "$K6_BIN"; return; fi
  if command -v k6 >/dev/null 2>&1; then echo "k6"; return; fi
  if [ -x "/c/Program Files/k6/k6.exe" ]; then echo "/c/Program Files/k6/k6.exe"; return; fi
  echo "k6 was not found. Install with: winget install k6 --source winget" >&2
  return 1
}

case "${1:-status}" in
  vertical)
    echo "Vertical mode: one Node stack, RATE_LIMIT_MAX=${RATE_LIMIT_MAX:-default}"
    start_replica 0
    ;;
  horizontal)
    count="${2:-3}"
    for index in $(seq 0 $((count - 1))); do start_replica "$index"; done
    ;;
  kill)
    count="${2:-1}"
    for index in $(seq $((count - 1)) -1 0); do stop_replica "$index"; done
    ;;
  stop)
    for file in "$RUN_DIR"/bdo-replica-*.pid; do
      [ -e "$file" ] || continue
      stop_replica "$(basename "$file" .pid | sed 's/bdo-replica-//')"
    done
    ;;
  status)
    for file in "$RUN_DIR"/bdo-replica-*.pid; do
      [ -e "$file" ] || continue
      index="$(basename "$file" .pid | sed 's/bdo-replica-//')"
      if healthy "$index"; then echo "Replica $index: UP   $(drive_url "$index")"; else echo "Replica $index: DOWN $(drive_url "$index")"; fi
    done
    ;;
  load)
    start_replica 0
    bin="$(k6_bin)" || exit 1
    K6_BASE_URL="$(drive_url 0)" "$bin" run "$ROOT/k6/bdo-load-test.js"
    ;;
  *)
    echo "Usage: $0 {vertical|horizontal N|kill N|stop|status|load}"; exit 2
    ;;
esac
