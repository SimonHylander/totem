# 0003: Define our own protocol

Status: Accepted (2026-09-25)

## Context

MCP was considered as a base. It provides JSON-RPC over streamable HTTP, capability negotiation and tool schemas, and agents consume it natively.

An integration platform needs much that MCP does not cover:

- Triggers, events and webhooks
- Tenant scoped credentials owned by the platform
- App lifecycle: install, configure, health, uninstall
- Durable execution: retries and idempotency keys
- Dependencies between apps

## Decision

We define our own protocol. It is not an MCP profile and does not track the MCP spec.

## Rejected

- **Extend MCP.** Most of the protocol would be extensions, and it would be tied to MCP spec revisions we do not control.

## Consequences

- We own the specification for transport details, capability negotiation and schemas. Borrow ideas from MCP and LSP freely.
- Agents do not get native MCP compatibility. If needed, the platform can expose installed apps through an MCP adapter later.
