# 0020: Protocol types derive from Effect Schemas, and both sides decode the wire

Status: Accepted (2026-11-10). Amends the hand-written mirrors in [0010](0010-typescript-types-from-manifest.md).

## Context

`@totem/protocol` mirrored the JSON Schemas as TypeScript types only. Nothing decoded wire data at runtime. `rpc` cast the reply and its result, the platform stored the manifest from `initialize` unchecked, and the platform, the SDK handler and `fakePlatform` passed params to methods unchecked.

## Decision

1. **The protocol defines an Effect Schema for each wire type and for each method's `params` and `result`.** Each exported type derives from its schema and keeps its name, so there is one definition per type.
2. **Method tables are values.** `AppMethods`, `PlatformMethods` and `SignedPlatformMethods` hold the schemas, and the type of the same name holds their types. `rpc` takes the table and decodes the result with the method's schema.
3. **Receivers decode params before a method runs.** They decode with `parseOptions` (`onExcessProperty: "error"`), so an unknown key fails as `additionalProperties: false` does. A bad param answers `InvalidParams`. The platform refuses a manifest that does not decode with `InvalidManifest`.
4. **JSON Schema stays the contract** ([0004](0004-json-schema-contracts.md)). `contract.test.ts` decodes every fixture with the Effect Schema and validates it with ajv.
5. **JSON Schema fields (`input`, `output`, `payload`, `config`) are typed `JSONSchema` from json-schema-to-ts** and checked only as a boolean or an object, so `as const satisfies Manifest` keeps its literal types (0010).

## Consequences

- An Effect Schema may accept more than its JSON Schema, never less for a fixture. It checks no `format`, does not check JSON Schema fields against the meta-schema, and takes any `protocolVersion` in `initialize`, so an app can still answer `ProtocolVersionUnsupported`.
- Derived types are readonly.
- `rpc` throws `Schema.SchemaError` for a result its schema rejects. The platform answers `InternalError` for it, except on `initialize`, where it is `InvalidManifest`.
- Signed methods decode all params before the signature check, so a malformed request answers `InvalidParams` before `Unauthorized`. Empty strings now pass the shape check, and the domain rules reject the unknown names. IDs are still decoded with their branded schemas.
