# 0008: Method set, invocation context and authentication

Status: Accepted (2026-09-26)

## Context

[0002](0002-json-rpc-over-http.md) set the transport and left signing open. This decision names the methods in both directions, says how per-call context travels, and settles authentication.

## Decision

### Platform to app

Sent to the app's URL. Schema: [`protocol/app-methods.schema.json`](../../protocol/app-methods.schema.json).

| Method | Purpose |
|--------|---------|
| `initialize` | Version handshake. Platform sends `protocolVersion` and `platformUrl`. App returns its manifest. |
| `health` | Liveness. |
| `install`, `uninstall` | Optional per-install lifecycle hooks. Receive an install context and a callback token. |
| `actions/invoke` | Run one action. Params: `action`, `input`, `context`, `callbackToken`. Result: `{ output }`. |

### App to platform

Sent to `platformUrl`. Schema: [`protocol/platform-methods.schema.json`](../../protocol/platform-methods.schema.json).

| Method | Purpose |
|--------|---------|
| `credentials/get` | Fetch a declared connection's current credential. |
| `state/get`, `state/set` | Install scoped key-value state. |
| `log` | Structured log line attached to the call. |
| `actions/invoke` | Call a declared port. The platform resolves the binding and invokes the provider. |

`events/emit` for triggers is deferred. The manifest already reserves the slot.

### Context in params

Every call carries a context object in the JSON-RPC params, never in HTTP headers. Schema: [`protocol/context.schema.json`](../../protocol/context.schema.json).

- Install context: `tenantId`, `installId`, `config`.
- Call context adds `callId`, `idempotencyKey`, `deadline`.

The body is what gets signed. Proxies strip headers.

### Authentication

- **Platform to app.** HMAC-SHA256 over `timestamp + "." + body` with a per-app secret issued at registration. Sent as `X-Ipaas-Signature: t=<unix>,v1=<hex>`. Apps reject stale timestamps.
- **App to platform.** A bearer token minted by the platform per call and passed in `callbackToken`. It is short-lived and scoped to one install and one call. The platform derives tenant, install and manifest from it, so driven port params carry no tenant fields. Install hooks receive an install-scoped token instead.

Apps store no platform secret beyond the HMAC key.

### Errors

Protocol errors use the JSON-RPC server range. Full list in [`protocol/README.md`](../../protocol/README.md). Apps report action failures with any code outside the reserved range and details in `error.data`.

## Rejected

- **Context in headers.** Not covered by the signature, and easy to lose behind proxies.
- **Long-lived app secret for platform calls.** One leaked secret would grant every tenant's data. Per-call tokens bound the blast radius.

## Consequences

- SDKs implement signing verification and token forwarding once. Authors never see either.
- Token minting sits on the invoke path, so it must be cheap. A signed token (no storage lookup) is the expected implementation.
- Streaming responses for long-running actions (SSE on the same connection) are not specified yet. `actions/invoke` is request-response for now.
