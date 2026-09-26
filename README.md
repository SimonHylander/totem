# IPAAS

A framework for building AI native integration platforms.

Third parties build apps in any language. The platform hosts, installs and composes them. A protocol defines every contract between apps and the platform.

## Platform

The platform is the runtime that hosts and installs apps. It owns tenants, credentials, permissions and versions. It composes installed apps by reading their manifests and routing calls between what apps provide and what they need.

## Protocol

The protocol is the contract. An app is valid as long as it speaks the protocol.

- JSON-RPC 2.0 over HTTP. Streaming (events, long running calls) uses SSE on the same connection.
- Our own protocol, not MCP. See [0003](docs/decisions/0003-own-protocol.md).
- Contracts are defined in JSON Schema. SDKs generate types from them.
- An app is an HTTP endpoint plus a manifest that declares what it provides and what it needs.
- Schemas live in [`protocol/`](protocol/).

## Apps

An app is a third party service that speaks the protocol. Integrations are apps that talk to external systems, with no separate contract (see [0006](docs/decisions/0006-integrations-are-apps.md)). The platform either runs it in a container or calls it at a remote URL. The protocol is identical in both cases.

## SDKs

SDKs make building apps easy. Each SDK gives app authors a hexagonal architecture:

- **Driving ports** are what the app provides (actions, triggers). Generated from the manifest. The author implements them.
- **Driven ports** are what the app needs from the platform (credentials, state, logging, other apps' actions). The SDK implements them as protocol calls.

Authors test apps by swapping driven adapters for in-memory fakes. No platform or network needed.

SDKs live in `sdk/`. Example apps live in `examples/`.

## Docs

- [Protocol](protocol/)
- [Decisions](docs/decisions/)
- [Open questions](docs/open-questions.md)
