#!/usr/bin/env bash
# Read-only health check of the active run: our processes own the ports, the UI renders, the
# tenant admin token works, and whether HubSpot is connected. Exits 1 on any failed check.
# Usage: doctor.sh
source "$(dirname "$0")/_common.sh"

run=$(current_run)
source "$run/instance.env"
pid=$(cat "$run/live.pid" 2>/dev/null || true)
failed=0

check() {
  if eval "$2" > /dev/null 2>&1; then echo "ok    $1"; else echo "FAIL  $1"; failed=1; fi
}

echo "run   $run"
check "live.ts (pid $pid) is running" "kill -0 $pid"
check "platform :3000 is ours" "[[ \$(listener 3000) == $pid ]]"
check "hubspot app :3002 is ours" "[[ \$(listener 3002) == $pid ]]"
check "events UI :3003 is our vite child" "[[ \$(ps -o ppid= -p \$(listener 3003) | tr -d ' ') == $pid ]]"
check "events page renders" "page / | grep -q '<h1>Events</h1>'"
check "tenant admin token works" "action $EVENTS_INSTALL listEvents '{}' | jq -e '.output.events | length > 0'"

if page /integrations | grep -q ' · hubspot connected'; then
  echo "ok    hubspot connected"
else
  echo "info  hubspot NOT connected: run connect.sh before proving the HubSpot sync"
fi
exit "$failed"
