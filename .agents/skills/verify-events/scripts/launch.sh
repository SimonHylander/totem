#!/usr/bin/env bash
# Build the events example's dependencies, start examples/events/scripts/live.ts as a run this
# skill owns, wait for the ready file it writes (<run>/ready.json), and write its ids to
# <run>/instance.env.
# Usage: launch.sh. Prints the run directory.
source "$(dirname "$0")/_common.sh"

for port in 3000 3002 3003; do
  pid=$(listener "$port")
  if [[ -n $pid ]]; then
    echo "port $port is taken by pid $pid: $(ps -o command= -p "$pid" | cut -c1-100)" >&2
    echo "If $RUNS/current points at a run, cleanup.sh stops it. Otherwise it belongs to someone else: ask before stopping it." >&2
    exit 1
  fi
done

run="$RUNS/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$run/evidence"
ln -sfn "$run" "$RUNS/current"

cd "$ROOT"
if ! pnpm exec turbo run build --filter=@totem/example-events^... > "$run/build.log" 2>&1; then
  echo "build failed, see $run/build.log" >&2
  exit 1
fi

cd examples/events
ready="$run/ready.json"
TOTEM_READY_FILE="$ready" nohup node --env-file-if-exists=../hubspot/.env.local scripts/live.ts \
  > "$run/live.log" 2>&1 &
echo $! > "$run/live.pid"

for _ in $(seq 1 120); do
  [[ -f $ready ]] && break
  if ! kill -0 "$(cat "$run/live.pid")" 2>/dev/null; then
    echo "live.ts exited during startup:" >&2
    tail -20 "$run/live.log" >&2
    exit 1
  fi
  sleep 1
done
[[ -f $ready ]] || { echo "live.ts not ready after 120s, see $run/live.log" >&2; exit 1; }

jq -r '"TOKEN=\(.token)", "CRM_INSTALL=\(.crmInstall)", "EVENTS_INSTALL=\(.eventsInstall)"' "$ready" > "$run/instance.env"
listener 3003 > "$run/vite.pid"

echo "$run"
