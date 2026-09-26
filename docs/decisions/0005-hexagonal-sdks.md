# 0005: SDKs give app authors a hexagonal architecture

Status: Accepted (2026-09-25)

## Context

The protocol (see [0001](0001-protocol-is-the-contract.md)) replaces hexagonal apps as the framework contract. Ports and adapters is still the right shape for writing an app, so it moves into the SDKs.

## Decision

Each SDK exposes two kinds of port.

- **Driving ports** are what the app provides: actions and triggers. The SDK generates them from the manifest, and the author implements them. The SDK's HTTP server is the driving adapter.
- **Driven ports** are what the app needs from the platform: credentials, HTTP, state and logging. The SDK implements them as protocol calls to the platform.

Sketch in TypeScript:

```ts
// Action names, inputs and outputs are typed from the manifest.
export default defineApp(manifest, {
  actions: {
    createContact: async (input, { credentials, http, state }) => {
      const token = await credentials.get("hubspot");
      return http.post("/contacts", { body: input, token });
    },
  },
});
```

## Rule

The protocol is the specification. The hexagon is an SDK convenience. An app built without an SDK, as a plain HTTP server that follows the protocol, is valid. SDK behavior never defines protocol behavior.

## Consequences

- Authors never handle JSON-RPC, signing or SSE directly.
- Tests replace driven adapters with in-memory fakes. No platform or network needed.
- A new platform service is a new driven port in the protocol, which every SDK then implements.
