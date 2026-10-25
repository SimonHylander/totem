# Decisions

One file per decision. Status is `Accepted`, `Proposed` or `Superseded`. To change an accepted decision, write a new one that supersedes it.

| # | Decision | Status |
|---|----------|--------|
| [0001](0001-protocol-is-the-contract.md) | The protocol is the contract between apps and the platform | Accepted |
| [0002](0002-json-rpc-over-http.md) | JSON-RPC 2.0 over HTTP with SSE for streaming | Accepted |
| [0003](0003-own-protocol.md) | Define our own protocol, not MCP | Accepted |
| [0004](0004-json-schema-contracts.md) | JSON Schema is the source of truth for contracts | Accepted |
| [0005](0005-hexagonal-sdks.md) | SDKs give app authors a hexagonal architecture | Accepted |
| [0006](0006-integrations-are-apps.md) | Integrations are apps. One concept, one contract | Accepted |
| [0007](0007-manifest.md) | The manifest. Pulled via `initialize`, needs are ports | Accepted |
| [0008](0008-methods-and-auth.md) | Method set, context in params, HMAC and per-call tokens | Accepted |
| [0009](0009-credentials-token-handoff.md) | Credentials by token handoff | Accepted |
| [0010](0010-typescript-types-from-manifest.md) | TypeScript infers types from the manifest literal, no codegen | Accepted |
| [0011](0011-platform-access.md) | Platform access stays inside the platform. Management tokens, two roles, one `can` | Proposed |
| [0012](0012-oauth-provider-details-in-manifest.md) | Apps declare provider details, the platform runs generic OAuth with pinned bindings | Proposed |
