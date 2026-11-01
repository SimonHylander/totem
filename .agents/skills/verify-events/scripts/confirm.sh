#!/usr/bin/env bash
# Prove a registration reached HubSpot. Reads the attendee's crmContactId from the events
# install, reads the contact back from HubSpot through the hubspot install's getContact action,
# and checks both ids match. Saves the responses, matching log lines and verdict.txt next to
# register.mjs's evidence.
# Usage: confirm.sh <email> [event name, default "HubSpot workshop"]. Exits 1 unless PASS.
# A registration made without a HubSpot connection reports "FAIL: the CRM sync failed".
source "$(dirname "$0")/_common.sh"

email=$(tr '[:upper:]' '[:lower:]' <<< "${1:?usage: confirm.sh <email> [event]}")
event=${2:-HubSpot workshop}
run=$(current_run)
source "$run/instance.env"
out="$run/evidence/$email"
mkdir -p "$out"

event_id=$(action "$EVENTS_INSTALL" listEvents '{}' | jq -r --arg n "$event" '.output.events[] | select(.name == $n) | .eventId')
[[ -n $event_id ]] || { echo "no event named \"$event\"" >&2; exit 1; }

action "$EVENTS_INSTALL" listAttendees "{\"eventId\":\"$event_id\"}" | jq . > "$out/attendees.json"
crm_id=$(jq -r --arg e "$email" '[.output.registered[], .output.waitlist[]] | map(select(.email == $e)) | .[0].crmContactId // empty' "$out/attendees.json")

# HubSpot can lag a moment behind a create, so retry the read.
for _ in 1 2 3 4 5; do
  action "$CRM_INSTALL" getContact "{\"email\":\"$email\"}" | jq . > "$out/hubspot-contact.json"
  hub_id=$(jq -r '.output.contact.contactId // empty' "$out/hubspot-contact.json")
  [[ -n $hub_id ]] && break
  sleep 2
done

# Log entries start with "[HH:MM:SS.mmm]" and continue on indented lines and "}" lines. Keep the
# whole entries that mention the email or the contact id.
awk -v email="$email" -v id="${hub_id:-no-contact-id}" '
  function flush() { if (index(entry, email) || index(entry, id)) printf "%s", entry; entry = "" }
  /^\[[0-9:.]+\] / { flush(); entry = $0 "\n"; next }
  entry != "" && /^( |\})/ { entry = entry $0 "\n"; next }
  { flush() }
  END { flush() }
' "$run/live.log" > "$out/live-log.txt"

if [[ -n $crm_id && $crm_id == "$hub_id" ]]; then
  verdict="PASS: $email is attendee of \"$event\" with crmContactId $crm_id, and HubSpot returns contact $hub_id"
elif [[ -z $crm_id ]] && grep -q 'CRM sync failed' "$out/live-log.txt"; then
  verdict="FAIL: the CRM sync failed for $email, see live-log.txt. Was HubSpot connected before registering?"
else
  verdict="FAIL: crmContactId='$crm_id', HubSpot contactId='$hub_id'"
fi
echo "$verdict" | tee "$out/verdict.txt"
[[ $verdict == PASS* ]]
