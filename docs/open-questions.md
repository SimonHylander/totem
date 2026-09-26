# Open questions

Questions that block or shape upcoming decisions. Move each one into a decision in [decisions/](decisions/) once it is answered.

- **Version negotiation.** `initialize` fails on a major mismatch (see [0008](decisions/0008-methods-and-auth.md)). What happens when an app's manifest version changes after installs exist.
- **Port compatibility.** Binding a `needs.actions` port to a provider is by name only (see [0007](decisions/0007-manifest.md)). Whether and how to check schema compatibility.
- **Streaming.** SSE on the same connection is decided ([0002](decisions/0002-json-rpc-over-http.md)) but `actions/invoke` is request-response. Shape of progress events and the final result for long-running actions.
- **Triggers.** Manifest declares them. `events/emit` and subscription are unspecified.
- **`packages/publish`.** The publisher ACL is dropped (see [0001](decisions/0001-protocol-is-the-contract.md)). Decide whether this package now means publishing apps to a registry, or remove it.
