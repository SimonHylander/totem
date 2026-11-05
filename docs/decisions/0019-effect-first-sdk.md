# 0019: The TypeScript SDK is Effect first

Status: Accepted (2026-11-05). Amends the TypeScript sketch in [0005](0005-hexagonal-sdks.md) and the authoring path in [0010](0010-typescript-types-from-manifest.md). Resolves the "Effect scope" fork in the paved paths.

## Context

`AGENTS.md` says Effect first, but the SDK and the examples were Promise code. Authors also wrote JSON Schema by hand: `required` could name a key that does not exist, a missing `additionalProperties: false` widened a handler's input, and nothing validated a call at runtime.

## Decision

1. **An app is defined with `Totem.Manifest` and `Totem.App`.** Handlers return an `Effect`, and `ctx` methods return an `Effect` that fails with `RpcError`. `defineApp` stays until the plain TypeScript SDK is finalized around this design.
2. **Effect Schema is the source of an action's types.** Handlers get a schema's decoded type. Callers outside the app use its encoded type.
3. **JSON Schema stays the wire contract** ([0004](0004-json-schema-contracts.md)). `Totem.Manifest` emits it from the schemas, so other SDKs read the same kind of document as before.
4. **The validator and the wire agree.** Schemas are emitted and run with `onExcessProperty: "error"`, so an object the manifest publishes as closed rejects an unknown key at runtime. Input, config and port output are decoded. Output and port input are encoded.
5. **`Totem.App` owns its layer.** The handlers' Effect builds once per process, on the first call that needs it, and again after a failure. `initialize` and `health` never run it, because the manifest is plain data. `dispose` closes the layer's scope.
6. **`ctx` stays a handler argument.** Tenant, install and callback token are per call, and its types come from `needs`. A service in `R` could not check a credential name against the manifest, and types cannot generate the runtime `needs` the wire requires.

## Rejected

- **A chained builder.** Manifest fields do not depend on each other, so call order would protect nothing.
- **SDK schema helpers that emit today's JSON byte for byte.** They add a second schema language next to `Schema`, and they give no runtime validation.
- **Deriving `needs` from `R`.** Types are erased, and a port's schemas have no form in `R`.

## Consequences

- Every action call is validated. A handler that returns an undeclared key now fails the call with `InternalError`.
- Emitted JSON differs from the hand-written documents: integers carry safe-integer bounds, enums carry `type: "string"`, and a nullable is `anyOf` with `null`. A manifest change is Breaking under [0017](0017-versioned-manifests.md), so an existing install moves through a new install.
- `Schema.Struct({})` accepts anything but null, so `Totem.Manifest` refuses it at the root of a schema. `Totem.Empty` is the empty object.
- A manifest imports `effect` at runtime, so a browser route that reads the manifest bundles it. `serve` moved to `@totem/sdk/serve`, so the SDK's root stays free of Node built-ins.
- A failed layer fails `install` and `uninstall`, because a hook is not known until the build runs.
- Deadlines still only appear on `ctx`. They do not interrupt a handler, and on a platform that never ends the process a layer's finalizers may not run.
