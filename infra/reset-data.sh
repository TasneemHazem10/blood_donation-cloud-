#!/usr/bin/env bash
# Lab 8 style clean run: stop the local stack, remove local test databases and
# start from an empty state. Does not touch Floci/Neon data.
#   bash infra/reset-data.sh
source "$(dirname "$0")/config.sh"

bash "$ROOT/infra/scale-test.sh" stop || true
bash "$ROOT/infra/run-floci.sh" stop || true
rm -f "$ROOT"/.data/bdo.sqlite "$ROOT"/.data/bdo.sqlite-* "$ROOT"/.data/bdo-replica-*.sqlite*
echo "Local SQLite data reset. Start again with: bash infra/run-floci.sh"
