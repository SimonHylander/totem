# 0001: The protocol is the contract

Status: Accepted (2026-09-25)

## Context

The framework targets third party app authors writing in any language. The first draft had apps as hexagonal modules loaded into the platform, with a publisher acting as an ACL between app and platform.

That model binds apps to one language and one process. Third party code would share memory and credentials with the platform. Port versions become package versions, and two apps needing different versions conflict.

## Decision

A wire protocol defines every contract between apps and the platform. An app is any service that speaks it.

- The protocol is the ACL. The separate publisher layer is dropped.
- Composition happens through manifests. Apps declare what they provide and need, and the platform routes between them.
- Versions are negotiated when the platform connects to an app.
- Apps the platform hosts run in containers for isolation.

## Rejected

- **Hexagonal apps loaded in-process.** Single language, no isolation. Hexagonal survives inside SDKs instead (see [0005](0005-hexagonal-sdks.md)).
- **WASM component model.** Typed and sandboxed, but async and networking in WASI are immature, and many languages and libraries do not compile to WASM well.

## Consequences

- Every call crosses a serialization boundary. Contracts carry only data. No callbacks, class instances or shared references.
- Failure modes are distributed. The protocol needs timeouts, retries and idempotency.
- Each supported language needs an SDK to keep authoring easy.
