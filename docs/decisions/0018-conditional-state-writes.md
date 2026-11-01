# 0018: State writes can name the version they read

Status: Accepted (2026-11-01). Amends the state methods of [0008](0008-methods-and-auth.md).

## Context

Install state had two methods, `state/get` and `state/set`. An app that changes a stored value reads it, computes the new value and writes it back. Two calls that run at the same moment both read the old value, and the second write replaces the first. The events app documented the result: an attendee could be lost, and the last seat could be given to two people.

Apps cannot prevent this on their own. One install can serve many concurrent calls, and the app holds no lock that spans them.

## Decision

1. **Every state key has a version.** `state/get` returns `{ value, version }`. The version is `0` while the key is unset.
2. **`state/set` takes an optional `version`.** With it, the write applies only if the key is still at that version. Otherwise the call fails with the new error `StateConflict` (`-32007`) and writes nothing. Without it, the write always applies, as before. `state/set` returns the key's new version, `0` after a delete.
3. **Versions come from one counter per install.** Every write takes the next value, so a key never gets back a version it had before, even after a delete and a new set. A write based on an old read cannot succeed by accident.
4. **The JS SDK hides versions behind `ctx.state.update(key, f)`.** It reads the key, stores `f(current)` with the version it read, and on `StateConflict` reads and tries again, up to 10 times. `f` can run more than once, so it must not have side effects. `get` and `set` keep their signatures.

The change is additive. Existing apps keep working, and the protocol version stays `1`.

## Rejected

- **A compare-and-set on the value.** The app would send the value it read back with every write. That doubles the payload, and it needs a definition of JSON equality.
- **Per-key counters that restart at 1.** After a delete and a new set, a key could repeat a version, and a write based on a read from before the delete would succeed.
- **Transactions over several keys.** No app needs them yet. An app that keeps related data under one key, as the events app does for each event, gets atomic changes from `update`.
- **Locks.** A lock held across calls needs timeouts and recovery when an app dies while holding it.

## Consequences

- Concurrent changes to one key are safe. Changes that span keys are not, so an app keeps data that must change together under one key.
- Under contention, `update` makes extra round trips, and after 10 conflicts it rethrows `StateConflict`.
- The platform stores a version with each key and one counter per install.
