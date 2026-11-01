# Open questions

Questions that block or shape upcoming decisions. Move each one into a decision in [decisions/](decisions/) once it is answered.

- **Breaking upgrades.** Installs pin a version and upgrade only when the change is compatible (see [0017](decisions/0017-versioned-manifests.md)). How a tenant moves config, connections and state across a breaking change.
- **Port compatibility.** A binding checks that the provider action exists (see [0013](decisions/0013-port-binding.md)), and an upgrade refuses any signature change (0017). Whether to accept compatible schema changes, such as a widened input.
- **Streaming.** SSE on the same connection is decided ([0002](decisions/0002-json-rpc-over-http.md)) but `actions/invoke` is request-response. Shape of progress events and the final result for long-running actions.
- **Triggers.** Manifest declares them. `events/emit` and subscription are unspecified.
- **End users in apps.** The events `/integrations` page has no login, and one deployment serves one install (see [0015](decisions/0015-apps-manage-their-ports.md)). Decide how an app signs in its users and creates a tenant install of itself for each new organization.
