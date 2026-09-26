# 0010: TypeScript infers types from the manifest literal

Status: Accepted (2026-09-26)

## Context

[0004](0004-json-schema-contracts.md) says every SDK generates bindings from JSON Schema. In TypeScript, `json-schema-to-ts` turns a schema literal into a type at compile time, with no generation step.

## Decision

The TypeScript SDK infers handler, port, credential and config types from the manifest written `as const satisfies Manifest`. There is no codegen for TypeScript apps.

Codegen remains the rule for Python and Go.

The `@ipaas/protocol` package carries hand-written TypeScript mirrors of the protocol schemas (`Manifest`, method tables, error codes) plus the shared signing and JSON-RPC helpers. Those mirrors must be kept in sync with the JSON files by hand until a generator is worth it.

## Consequences

- One source of truth per app: the manifest. Types cannot drift from what the platform sees.
- Deep or recursive schemas can hit TypeScript's instantiation limits. If that happens, the author can widen a schema to `object` and validate inside the handler.
- The hand-written mirrors are debt. A test validating a sample manifest against the JSON Schema and against the type guards the gap.
