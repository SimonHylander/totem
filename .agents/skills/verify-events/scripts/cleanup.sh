#!/usr/bin/env bash
# Stop the active run's processes, by the pids launch.sh recorded, and wait for its ports to free.
# Evidence and logs stay in the run directory.
# Usage: cleanup.sh
source "$(dirname "$0")/_common.sh"

run=$(current_run)
for file in live.pid vite.pid; do
  pid=$(cat "$run/$file" 2>/dev/null || true)
  [[ -n $pid ]] && kill "$pid" 2>/dev/null || true
done

for _ in $(seq 1 15); do
  [[ -z $(listener 3000)$(listener 3002)$(listener 3003) ]] && break
  sleep 1
done
for port in 3000 3002 3003; do
  pid=$(listener "$port")
  [[ -n $pid ]] && echo "port $port is still taken by pid $pid" >&2
done

rm -f "$run/live.pid" "$run/vite.pid" "$RUNS/current"
echo "stopped. evidence kept in $run/evidence"
