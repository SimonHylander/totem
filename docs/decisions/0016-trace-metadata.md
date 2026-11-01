# 0016: Trace metadata in the signed request, anchored by the callback token

Status: Accepted (2026-10-27). Amends the context rule of [0008](0008-methods-and-auth.md).

## Context

One operation crosses several processes. A management call or `actions/start` reaches the platform. The platform invokes an app, the app calls back (`credentials/get`, `state/*`, `log`, a port call), and a port call makes the platform invoke a provider app ([0013](0013-port-binding.md)). The only correlation is `callId`, and every hop gets a new one.

The platform and the apps belong to different parties. Each exports telemetry to its own backend, or nowhere. The protocol has to carry a parent pointer between them, and each process has to choose its own logger and tracer.

[0008](0008-methods-and-auth.md) puts context in the signed body and rejects headers, because the signature does not cover them and proxies strip them. That reasoning applies to a trace parent too.

## Decision

1. **Any JSON-RPC request may carry `trace: { traceparent }` beside `params`.** [`protocol/trace.schema.json`](../../protocol/trace.schema.json) defines it: W3C trace context, version `00`, lowercase hex, IDs not all zeros. It is part of the signed body. Method and context schemas do not change, and the protocol version stays `1`.
2. **Trace metadata never fails a request and never grants access.** A receiver ignores a missing or invalid value, and only reads it after the signature or token has verified.
3. **The callback token anchors platform work.** When the platform calls an app, it opens a client span, sends it as `trace`, and records the same span in the callback token. Callbacks are children of the token's span. A valid `trace` on a callback with the same trace ID becomes a span link, not the parent. An app cannot move platform work into another trace or change its sampling.
4. **Callers that start an operation bring their trace.** Signed methods ([0014](0014-apps-start-their-own-actions.md), [0015](0015-apps-manage-their-ports.md)) continue their `trace` once the signature verifies. The management API continues a W3C `traceparent` header once the principal authenticates. It is not on the JSON-RPC path, so 0008 does not cover it. Browser pages and the OAuth callback start new traces.
5. **A forwarded port call stays in the trace.** It still gets a new `callId`, its own context and its own token (0013). `callId` remains the per-hop identifier.
6. **`log` is unchanged.** The platform writes the line under the token's span, with `installId` and `callId`. The app's `data` cannot overwrite them.
7. **Each process exports its own telemetry.** No method carries spans or log records to the platform. The platform takes logger and tracer layers through `createPlatform`. The JS SDK takes an Effect runtime from the app.

### Amendment to 0008

"Every call carries a context object in the JSON-RPC params, never in HTTP headers" now reads: every call carries a context object in the JSON-RPC params, and any request may carry trace metadata in the JSON-RPC envelope. Neither travels in HTTP headers.

## Rejected

- **W3C headers on JSON-RPC calls.** Standard HTTP instrumentation would read them, but they are unsigned and proxies strip them. That is what 0008 rejected.
- **Trace fields in the call context.** The app-to-platform methods have no context object, so each method schema would need its own field.
- **Callbacks parented on the app's span.** It gives an exact tree in a shared backend, but an app could reparent platform work and flip its sampling.
- **The platform as a telemetry hub.** The protocol would carry span data, the operator would ingest third-party telemetry, and apps could not choose their own backend.

## Consequences

- One trace ID spans the platform, the app and any provider app. Each process exports its own spans, so a backend sees only the spans it receives.
- In a shared backend, platform callback spans are siblings of the app's spans, connected by links.
- A plain HTTP app stays valid. To join the trace, it reads `trace` from the request and sets it on its own requests.
- A captured request carries its trace ID, which is random and holds no data.
