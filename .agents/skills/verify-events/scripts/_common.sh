# Shared paths and helpers for the verify-events scripts. Sourced by each script, never run.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
RUNS="${VERIFY_EVENTS_RUNS:-/tmp/verify-events}"
PLATFORM=http://localhost:3000
EVENTS=http://localhost:3003

# Directory of the run the last launch.sh created. Exits when no run is active.
current_run() {
  if [[ ! -L $RUNS/current ]]; then
    echo "no active run: start one with launch.sh" >&2
    exit 1
  fi
  readlink "$RUNS/current"
}

# The pid listening on a TCP port, or nothing.
listener() {
  lsof -nP -iTCP:"$1" -sTCP:LISTEN -t 2>/dev/null | head -1 || true
}

# Start an action on an install as the tenant admin and print the JSON response.
# Usage: action <installId> <action> <input-json>. Needs TOKEN from instance.env.
action() {
  curl -sS -X POST "$PLATFORM/api/installs/$1/actions/$2" \
    -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -d "{\"input\":$3}"
}

# Server-rendered HTML of an events UI path, without React's <!-- --> text separators, so
# grep matches rendered text such as " · hubspot connected".
page() {
  curl -sS "$EVENTS$1" | sed 's/<!-- -->//g'
}
