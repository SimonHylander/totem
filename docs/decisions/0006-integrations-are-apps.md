# 0006: Integrations are apps

Status: Accepted (2026-09-25)

## Context

The first draft named apps, integrations and the platform as separate parties. It was open whether an integration needed its own tier and contract.

## Decision

There is one concept: the app. An integration is an app whose actions and triggers talk to an external system. The protocol, manifest and SDKs make no distinction.

## Consequences

- One contract to specify, version and implement in every SDK.
- Anything an integration needs from the platform, such as tenant credentials or webhooks, is a driven port available to every app.
- "Integration" is a descriptive term only. It never appears as a type in the protocol.
