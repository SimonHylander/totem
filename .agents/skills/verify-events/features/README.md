# Events verification map

The maintained list of user-facing behaviour in the events example app and how to prove each one. Read the index, then use the matching feature file as the recipe.

## Baseline preconditions

- A run started by `scripts/launch.sh` and a clean `scripts/doctor.sh`.
- The seeded state of a fresh run: tenant `acme`, one events install bound to one hubspot install, and two events. "Totem launch" has 2 seats and "HubSpot workshop" has 20.
- HubSpot connected through `scripts/connect.sh`, for every feature that touches HubSpot.

## Driving conventions

- Drive the UI at `http://localhost:3003` with `playwright-core` from `~/.cache/totem-verify` and `chromium.launch({ channel: "chrome" })`, as `scripts/register.mjs` does. Use `localhost`, because the platform rejects any other origin for the connect `returnTo`.
- Find controls by role and accessible name. The names in the feature files are the rendered text.
- Wait for `networkidle` after each navigation before using a form or button. Until hydration, buttons do nothing and forms submit as a native GET.
- Read state back through the platform API: `action <installId> <action> <input-json>` in `scripts/_common.sh`, with `TOKEN`, `CRM_INSTALL` and `EVENTS_INSTALL` from `<run>/instance.env`.
- Register with a fresh `verify+<timestamp>@example.com` every time.
- Save artifacts under `<run>/evidence/<feature>/`.

## Proof and skip reporting

- Capture the user action and the resulting state: a screenshot or ARIA snapshot from the UI, and a read-back through the API.
- A HubSpot claim needs the `getContact` response from the hubspot install.
- Report the feature, the entry point used, and the run directory with each result.
- Report a path you could not reach, with the unmet precondition. A path counts as verified only if you drove that path.

## Feature entry contract

Each feature file has an H1 title and one paragraph on the user-visible behaviour, then four H2 sections in this order: `Sub-features`, `How to get to it (user POV)`, `Driving it with playwright-core`, `Gotchas`.

## Features

- [Browse events](./browse-events.md): the event list, seat counts, and opening an event.
- [Register](./register.md): registering, the waitlist, and failed registration.
- [HubSpot sync](./hubspot-sync.md): a registration becomes a HubSpot contact, or logs a failed sync.
- [Integrations](./integrations.md): enabling, disabling and connecting the CRM provider.
