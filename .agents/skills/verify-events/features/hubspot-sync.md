# HubSpot sync

Each new registration creates or updates a HubSpot contact through the install's CRM provider. The attendee keeps the contact id. When the sync fails, the registration still stands and the app logs the failure.

## Sub-features

- `sync-created` creates a contact for a new email and stores its id as the attendee's `crmContactId`.
- `sync-updated` updates an existing HubSpot contact with that email and stores its id.
- `sync-failed` keeps the registration with `crmContactId: null` and logs `CRM sync failed` when HubSpot is not connected or the provider is disabled.

## How to get to it (user POV)

- Register for any event while HubSpot is connected on `http://localhost:3003/integrations`. The user never sees the sync. It shows only in HubSpot.

## Driving it with playwright-core

Preconditions:

- Baseline run with `scripts/connect.sh` reporting `hubspot connected`, except for `sync-failed`.

- **Created.** Run `email="verify+$(date +%s)@example.com"`, then `node scripts/register.mjs --email "$email"`, then `scripts/confirm.sh "$email"`. Expect `PASS` and a `contact created` line in `live-log.txt`.
- **Updated.** Register an email that already exists in HubSpot but not in this run, such as one from an earlier run's evidence. Then run `confirm.sh` on it. Expect `PASS` and a `contact updated` line.
- **Failed.** In a run without a connection, or after turning off the `hubspot` switch on the integrations page, register a fresh email and run `confirm.sh`. Expect `FAIL: the CRM sync failed`, `crmContactId: null` in `attendees.json`, and a `CRM sync failed` line with the error in `live-log.txt`. For this path, that FAIL is the expected result.
- **Proof.** `<run>/evidence/<email>/verdict.txt`, `attendees.json` and `hubspot-contact.json`.

## Gotchas

- Register only after the connection exists. A registration made before connecting keeps `crmContactId: null` forever, because a repeat registration does not retry the sync.
- Every run creates real contacts in the HubSpot test account, and they are not deleted.
- `getContact` can return `null` for a moment after a create. `confirm.sh` retries for 10 seconds.
- `getContact` answers 422 while HubSpot is not connected. `hubspot-contact.json` then holds the error, not a contact.
