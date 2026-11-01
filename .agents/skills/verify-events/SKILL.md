---
name: verify-events
description: Drive the events example app (web UI on :3003, backed by the platform and the HubSpot app) in headless Chrome and capture proof. Use to verify a change to examples/events, examples/hubspot, or the platform's ports, OAuth or actions, or when asked to run or drive the events app, for example registering for an event and confirming the contact lands in HubSpot.
---

# Verify the events app

One run is one `examples/events/scripts/live.ts` process. It owns the platform (:3000), the HubSpot app (:3002) and the events UI (:3003, a vite child). The platform keeps everything in memory, so each launch has new tokens, installs and events, and HubSpot must be connected again. The ports and the HubSpot redirect URL are fixed, so only one instance can run. Drive only a run this skill launched.

Scripts are in `.agents/skills/verify-events/scripts/` (called `scripts/` below) and run from any directory. A run lives in `/tmp/verify-events/<timestamp>/`, and `/tmp/verify-events/current` links to the active one.

## 1. Launch

One-time setup: the browser driver uses `playwright-core` from outside the repo and drives the installed Google Chrome.

```sh
npm install --prefix ~/.cache/totem-verify playwright-core@1.55
```

Start a run:

```sh
scripts/launch.sh
```

It refuses when any of the three ports is taken and prints the owner. If `/tmp/verify-events/current` exists, that is a stale run of ours: run `scripts/cleanup.sh` and launch again. Otherwise the instance belongs to the user: ask them to stop it. The script is ready when it prints the run directory. That takes about 15 seconds. It writes `TOKEN` (tenant admin), `CRM_INSTALL` (hubspot install) and `EVENTS_INSTALL` to `<run>/instance.env`. The full process output goes to `<run>/live.log`.

Requires `examples/hubspot/.env.local` with `HUBSPOT_CLIENT_ID` and `HUBSPOT_CLIENT_SECRET`.

The run is a child of your shell session and stops when that session ends. Doctor then fails on every line. Run cleanup, launch again, and have the user connect HubSpot again.

## 2. Doctor

```sh
scripts/doctor.sh
```

Run it after launch and whenever anything looks off. Every line must read `ok` before you drive. The last line reports whether HubSpot is connected.

## 3. Connect HubSpot

HubSpot consent needs the user's HubSpot login, so ask the user to do this step:

> Open http://localhost:3003/integrations, press **Connect hubspot**, and approve in HubSpot.

Then wait for it:

```sh
scripts/connect.sh
```

It exits 0 once the page shows ` · hubspot connected`. Without a connection, registrations still succeed but every CRM sync fails. That is a valid run only when the negative path is what you are verifying.

## 4. Drive

The feature map in [`features/README.md`](features/README.md) lists every user path and how to drive it. Read the feature file before driving that feature. The register-to-HubSpot proof:

```sh
email="verify+$(date +%s)@example.com"
node scripts/register.mjs --email "$email" --event "HubSpot workshop"
scripts/confirm.sh "$email" "HubSpot workshop"
```

`register.mjs` registers through the UI. `confirm.sh` checks that the attendee's `crmContactId` equals the contact id HubSpot returns for that email. It prints `PASS` or `FAIL` and exits non-zero on `FAIL`.

## 5. Evidence

Everything for one registration lands in `<run>/evidence/<email>/`:

| File                                | Proves                                                                                                   |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `1-events.png`, `2-filled.png`      | the user path: event list, then the filled form                                                          |
| `3-result.png`, `3-result.aria.txt` | what the user saw after pressing Register                                                                |
| `result.json`                       | seats before, outcome text, page URL                                                                     |
| `attendees.json`                    | the events install stored the attendee and its `crmContactId`                                            |
| `hubspot-contact.json`              | HubSpot itself returns the contact                                                                       |
| `live-log.txt`                      | the app log lines for this email and contact id (`registered for`, `contact created`, `CRM sync failed`) |
| `verdict.txt`                       | the verdict line                                                                                         |

Proof standards:

- Register through the UI. The platform API is the second, read-only view, used to confirm.
- A success message alone proves nothing about HubSpot, because the UI shows the same text when the sync fails. Only a matching `hubspot-contact.json` proves the sync.
- Each registration creates a real contact in the connected HubSpot test account. Use a fresh `verify+<timestamp>@example.com` every time, because a repeat email returns its first result without calling HubSpot again.
- Report the run directory and the verdict line.

## 6. Cleanup

```sh
scripts/cleanup.sh
```

It stops the pids launch recorded, waits for the ports to free, and removes `/tmp/verify-events/current`. The run directory and its evidence stay. Run it after every attempt, including failed ones. The HubSpot contacts it created stay in HubSpot, because the hubspot app has no delete action.
