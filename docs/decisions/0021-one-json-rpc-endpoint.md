# 0021: One Effect endpoint receives every JSON-RPC request

Status: Accepted (2026-11-10)

## Context

Three receivers speak the protocol: the app endpoint in the SDK, the platform's callback-token methods and its signed methods ([0014](0014-apps-start-their-own-actions.md), [0015](0015-apps-manage-their-ports.md)). `fakePlatform` is a fourth. Each one parsed the body, checked the envelope, found the method, decoded `trace` and wrapped the result or error in an envelope. The copies had already drifted: the SDK was Promise code and the platform was Effect code, and a method name such as `toString` reached `Object.prototype`.

The receivers differ in when they authenticate. The SDK and the callback methods check a signature or token before parsing. A signed method names its install in params, and the install picks the secret, so it authenticates after parsing.

## Decision

1. **`endpoint` in `@totem/protocol` turns a `Request` into an `Effect<Response>`.** It owns parsing, the envelope check, method lookup, decoding params with the method's schema ([0020](0020-protocol-effect-schemas.md)), `trace` decoding, the error envelope for an `RpcError`, the logged `InternalError` for a defect and the HTTP 401 for a failed authentication.
2. **Authentication runs `beforeParse` or `afterLookup`.** A failure before parsing answers with a null id. `afterLookup` runs once the params have decoded and receives them. Its failure answers with the request's id. Authentication fails with `Unauthorized`, which answers HTTP 401. Trace metadata is read only after authentication ([0016](0016-trace-metadata.md)).
3. **Caller-specific behavior stays with the caller.** Each caller passes its handlers, its authentication, an optional `toRpcError` for its own failures, and an optional `around` that wraps every handler, such as the platform's spans. The SDK keeps its 405 for non-POST requests and runs the Effect at its Promise edge.

The protocol was Promise-only code. It now holds one Effect module, and `effect` was already its dependency.

## Rejected

- **A shared Promise helper.** The platform would convert at every request, and AGENTS.md says Effect first.
- **The endpoint in the SDK.** The platform may not import the SDK (`sdk-uses-only-the-protocol` and the layering in AGENTS.md), so the protocol is the only package both can use.
- **Effect `HttpApi` or `RpcServer`.** They define their own wire format, and the wire format is the protocol's ([0002](0002-json-rpc-over-http.md)).

## Consequences

- A receiver answers bad JSON, an unknown method, failed authentication and a defect the same way, with the same codes and messages.
- Params decode in one place, so every handler gets its method's typed params, and a bad param answers InvalidParams before `afterLookup` runs.
- `fakePlatform` now answers a malformed request and a non-`RpcError` failure with an envelope, as the platform does, where it threw before.
