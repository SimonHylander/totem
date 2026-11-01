#!/usr/bin/env bash
# Wait for the human to connect HubSpot on the integrations page. HubSpot consent needs the
# user's HubSpot login, so a person does this once per launch.
# Usage: connect.sh. Exits 0 once connected, 1 after 10 minutes.
source "$(dirname "$0")/_common.sh"
current_run > /dev/null

if page /integrations | grep -q ' · hubspot connected'; then
  echo "hubspot already connected"
  exit 0
fi

echo "Waiting for the user to open $EVENTS/integrations, press \"Connect hubspot\", and approve in HubSpot."
for _ in $(seq 1 200); do
  if page /integrations | grep -q ' · hubspot connected'; then
    echo "hubspot connected"
    exit 0
  fi
  sleep 3
done
echo "hubspot not connected after 10 minutes. A Connect pressed more than 10 minutes ago has expired, so press it again and rerun connect.sh." >&2
exit 1
