# Register

A visitor registers for an event with an email and optional first and last name. They get a seat while seats remain, and a waitlist position after that.

## Sub-features

- `register-seat` shows `You're registered. You have seat N.` and lowers the seat count.
- `register-waitlist` shows `The event is full. You're number N on the waitlist.` once the event is full, and the page reads `Full. New registrations join the waitlist.` before submit.
- `register-repeat` returns the first result for an email that is already registered, without a new seat.
- `register-failed` shows the alert `Registration failed. Please try again.` and keeps the form.

## How to get to it (user POV)

- Open `http://localhost:3003/`, choose an event link, fill the form, and press `Register`.
- Open `http://localhost:3003/events/<eventId>` directly.

## Driving it with playwright-core

Preconditions:

- Baseline run. HubSpot does not need to be connected, unless you also prove the sync (see [hubspot-sync.md](./hubspot-sync.md)).

- **Seat.** Run `node scripts/register.mjs --email "verify+$(date +%s)@example.com" --event "HubSpot workshop"`. `result.json` has an `outcome` of `You're registered. You have seat N.`
- **Waitlist.** Register three fresh emails for `Totem launch` with `--event "Totem launch"`. The first two get seats 1 and 2. The third gets `The event is full. You're number 1 on the waitlist.`
- **Repeat.** Run `register.mjs` again with an email already used for that event. The outcome repeats that email's original seat or waitlist number, and the seat count does not change.
- **Proof.** `<run>/evidence/<email>/` holds the screenshots, the ARIA snapshot and `result.json`. Read the stored attendee back with `action $EVENTS_INSTALL listAttendees '{"eventId":"<id>"}'`, taking the id from `listEvents`.

## Gotchas

- The email is trimmed and lowercased before storage. Compare against the lowercased address.
- The success text is identical whether or not HubSpot synced. It is not proof of the sync.
- `register-failed` needs a failing `register` action, and the UI has no input that causes one. Report it as unreachable instead of faking a failure.
- "Totem launch" fills after two registrations in a run. Use "HubSpot workshop" for anything that needs a seat.
