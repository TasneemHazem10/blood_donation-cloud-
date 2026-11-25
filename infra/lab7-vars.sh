#!/usr/bin/env bash
# Lab 7 style environment restore. Source it to get API_ID and API_URL back:
#   source infra/lab7-vars.sh
# When executed directly it prints the export lines instead. No secrets here.
source "$(dirname "${BASH_SOURCE[0]}")/config.sh"
load_state

export API_ID="${API_ID:-}"
export API_URL="${API_URL:-}"

if [ "${BASH_SOURCE[0]}" != "$0" ]; then
  echo "Restored API_ID=$API_ID and API_URL=$API_URL in this shell."
else
  echo "export API_ID='$API_ID'"
  echo "export API_URL='$API_URL'"
fi
