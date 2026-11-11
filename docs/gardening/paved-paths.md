# Paved paths

One blessed way to solve each recurring problem. Copy the exemplar. Weed ids point into [anti-patterns.md](anti-patterns.md). If an **Exemplar** line names a weed, the file still holds that weed, so leave those lines out when you copy.

The repo has two zones. Packages, the platform and apps are Effect code. The protocol and the SDK's transport are Promise code, behind `Totem.App` (ADR 0019), except the protocol's `endpoint`, which receives every request (ADR 0021). An entry applies to both zones unless it names one.

## Apps

- **Path:** declare the manifest with `Totem.Manifest` and Effect schemas in its own file, and define the app with `Totem.App({ manifest, layer }, Effect.gen(...))`.
- **Exemplar:** `examples/hubspot/src/app.ts`
- **Enforced by:** the types of `Totem.Manifest` and `Totem.App`
- **Why:** one schema types the handler, validates the call and emits the wire's JSON Schema (ADR 0019).

## Domain packages

- **Path:** copy `packages/installs`: `model.ts`, `transitions.ts`, `errors.ts`, `port.ts`, `index.ts` and a table test. Rule files may take a name that says what they do, such as `authorize.ts`. A package with no I/O has no `port.ts`.
- **Exemplar:** `packages/installs/src/transitions.ts`. Holds W2.
- **Enforced by:** dependency-cruiser `domain-stays-pure`, `domain-has-no-io` and `domain-has-no-effect-io`. File layout is unenforced.
- **Why:** pure rules return `Result`, so they are tested with a table and no layers.

## Ports and adapters

- **Path:** declare a port in the domain package as `class X extends Context.Service<X, {...}>()("@totem/<pkg>/X")`. Provide it in the platform as a `Layer` beside the module it adapts, such as `installRepoLayer` in `platform/src/installs/installs.ts`.
- **Exemplar:** `packages/installs/src/port.ts`
- **Enforced by:** dependency-cruiser layer rules (`pnpm boundaries`)
- **Why:** the domain names what it needs, and only the platform touches I/O.

## Errors

- **Path:** Effect zone: one `Schema.TaggedError` class per failure, in the package's `errors.ts`. Map each new tag in `STATUS` (`platform/src/http/api.ts`) and `RPC_CODES` (`platform/src/http/rpc.ts`). An app handler fails with `AppError` from `@totem/sdk`. The SDK's transport throws `RpcError` from `@totem/protocol`.
- **Exemplar:** `packages/installs/src/errors.ts`
- **Enforced by:** the `STATUS` and `RPC_CODES` records are keyed by every `PlatformError` tag, so a missing mapping is a type error. Bare `new Error` is W10, unenforced.
- **Why:** the wire needs a status and a numeric JSON-RPC code for every failure.

## IDs

- **Path:** branded schemas from `@totem/ids`. Mint with `XId.make(crypto.randomUUID())` in the platform. The protocol and SDK use plain `string`, because `sdk-uses-only-the-protocol` forbids `@totem/ids` there.
- **Exemplar:** `packages/ids/src/index.ts`
- **Enforced by:** `noStringIds` in `eslint.config.mjs`, packages only (W7)
- **Why:** a brand stops one kind of ID being passed as another.

## Async code

- **Path:** Effect zone: return an `Effect`. Wrap a Promise API with `Effect.tryPromise` at the call site.
- **Exemplar:** `platform/src/app-calls/app-calls.ts`. Holds W4 and W6.
- **Enforced by:** `noPromises` in `eslint.config.mjs`, on packages and the platform minus `node.ts`, `server.ts` and tests (W6)
- **Why:** errors, dependencies and interruption stay typed end to end.

## Protocol calls

- **Path:** `rpc()` from `protocol/src/jsonrpc.ts`. The platform calls apps through `callApp` in `platform/src/app-calls/app-calls.ts`. Apps call the platform through `platformClient` in the SDK.
- **Exemplar:** `platform/src/app-calls/app-calls.ts`. Holds W4 and W6.
- **Enforced by:** unenforced
- **Why:** one client signs and traces every protocol request.

## Third-party HTTP from the platform

- **Path:** Effect `HttpClient`, with `HttpClientResponse.schemaBodyJson` to decode the response.
- **Exemplar:** `platform/src/connections/connections.ts`. Holds W7.
- **Enforced by:** unenforced
- **Why:** the response is decoded, and the span records only the host (ADR 0016).

## Inbound handlers

- **Path:** handlers live in the folder of the capability they serve, such as `platform/src/installs/`. A management endpoint is one `route(method, path, paramsSchema, bodySchema, run)` entry in its `routes.ts`. A platform method is one entry in `methods` (callback token) or `signedMethods` (HMAC) in its `methods.ts`. A browser page is one `page(path, run)` entry in its `pages.ts`. `platform/src/http/` merges them and holds no capability logic.
- **Exemplar:** `platform/src/installs/routes.ts`
- **Enforced by:** unenforced
- **Why:** params and body are decoded before `run`, and errors map to statuses in one place.

## Logging and tracing

- **Path:** `Effect.log*` and `Effect.withSpan` in library code. `console` only in entry points and scripts.
- **Exemplar:** `platform/src/http/rpc.ts`
- **Enforced by:** `no-console` on protocol, SDK, platform and packages, except `platform/src/server.ts` (W8)
- **Why:** logs and spans carry the trace context (ADR 0016).

## Secrets

- **Path:** hold a secret as `Sealed` from `platform/src/secrets.ts`. Call `reveal()` only where the secret is sent or used as a key.
- **Exemplar:** `platform/src/connections/connections.ts`. Holds W7.
- **Enforced by:** `no-restricted-properties` on `reveal`, with a file allowlist (W9)
- **Why:** `Sealed` prints `[sealed]` in logs, JSON and the inspector.

## Platform state

- **Path:** a `Table` from `platform/src/table.ts`, held by the service of the module that writes it, such as `Apps` in `platform/src/apps/apps.ts`. Records are immutable, and each write replaces the record. Installs and connector credentials are the exceptions: the `Installs` service in `platform/src/installs/installs.ts` writes installs, and the `Connections` service in `platform/src/connections/connections.ts` writes OAuth clients and pending connects and is the only caller that writes an install's connections.
- **Exemplar:** `platform/src/apps/apps.ts`
- **Enforced by:** unenforced
- **Why:** state is in memory (ADR 0011), and every table has one writer.

## Tests

- **Path:** co-located `*.test.ts` on vitest. Domain rules: a table of cases. Apps and the SDK: `fakePlatform` from `@totem/sdk`. Platform flows: `testPlatform` from `platform/src/testing/test-network.ts`, which wires the platform and apps over an injected `fetch`.
- **Exemplar:** `packages/installs/src/transitions.test.ts`
- **Enforced by:** unenforced
- **Why:** each layer is tested at its own seam, with no network.

## Styling

- **Path:** one plain stylesheet per app, with tokens as custom properties on `:root`. Follow `DESIGN.md`: self-host Figtree through `@fontsource-variable/figtree`, and derive tints from `--accent` with `color-mix()`.
- **Exemplar:** `examples/events/src/styles.css`
- **Enforced by:** unenforced
- **Why:** a tenant themes an app by overriding one token, `--accent`.

## Validation at I/O boundaries (fork)

- **Path:** none yet. Three live approaches:
  - Effect `Schema` decode: 6 platform files, such as `route()` in `platform/src/http/route.ts` and `callback-token.ts`.
  - Hand-rolled guards: an inline object check in `platform/src/http/api.ts` and the field readers in the events `server.ts` files (W12).
  - `as` casts on parsed JSON, such as `examples/hubspot/src/hubspot.ts:60` (W2).
- **Recommendation:** Effect `Schema` everywhere. It is the only approach that types the value from one source, and the protocol and SDK already depend on `effect`. JSON Schema stays the cross-language contract (ADR 0004), and `Schema` decodes values inside TypeScript. Candidate exemplar: `platform/src/app-calls/callback-token.ts`.

## Configuration and environment variables (fork)

- **Path:** none yet. All 15 reads are direct `process.env`, in entry points, live scripts and `examples/events/src/totem/connection.ts`. Four entry points repeat a `throw new Error("X is required")` check (W5).
- **Recommendation:** Effect `Config`, read once per entry point. Candidate exemplar: `examples/events/src/totem/connection.ts` after migration, since it already reads lazily and fails loudly.
