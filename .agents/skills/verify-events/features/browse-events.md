# Browse events

The home page lists every event of the install with its remaining seats, and each event opens its own page.

## Sub-features

- `list` shows each event name and ` · N of M seats left`, or ` · full, waitlist open`.
- `empty` shows `No events yet.` when the install has no events.
- `open` opens `/events/<eventId>` with the event name as the heading.
- `load-error` shows `Events could not be loaded.` when the loader fails.

## How to get to it (user POV)

- Open `http://localhost:3003/`.
- Choose the link `All events` on an event page or the integrations page.

## Driving it with playwright-core

Preconditions:

- Baseline run. HubSpot does not need to be connected.

- **List.** Go to `/`. Expect the heading `Events` and links `Totem launch` and `HubSpot workshop`. In a fresh run, the text after them reads `2 of 2 seats left` and `20 of 20 seats left`.
- **Open.** Choose the link `HubSpot workshop`. Expect the heading `HubSpot workshop` and the text `20 of 20 seats left.`.
- **Back.** Choose the link `All events`. Expect the `Events` heading again.
- **Proof.** Save a screenshot and `page.locator("main").ariaSnapshot()` of the list. Read the same counts back with `action $EVENTS_INSTALL listEvents '{}'`.

## Gotchas

- `empty` cannot be reached in a launched run, because live.ts always seeds two events.
- `load-error` is what `pnpm dev` alone shows: without live.ts there is no platform and no `EVENTS_INSTALL_ID`. It is not a useful thing to drive.
- Seat counts change with every registration in the run. Compare against the counts read just before the action.
