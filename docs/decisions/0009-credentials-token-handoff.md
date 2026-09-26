# 0009: Credentials by token handoff

Status: Accepted (2026-09-26)

## Context

The platform owns OAuth flows and secrets per tenant. Apps need to call external APIs on the tenant's behalf. Two models were considered.

- **Token handoff.** The app asks for a credential and calls the external API itself.
- **Platform proxy.** The app sends the request to the platform, which injects auth and forwards it. The app never sees a secret.

## Decision

Token handoff. `credentials/get { name }` returns the current credential for a connection declared in `needs.credentials`. For `oauth2` that is an access token and expiry. For `apiKey` it is the key. The platform refreshes tokens. Apps treat credentials as ephemeral and never persist them.

## Rejected for now

- **Platform proxy.** Better isolation, audit and egress control, and no secret leaves the platform. It costs an extra hop per external call and complicates streaming and large bodies. It is additive: an `http/fetch` driven port can be introduced later against the same `needs.credentials` declaration.

## Consequences

- Client secrets and refresh tokens never leave the platform. Access tokens do, for their lifetime.
- SDKs expose `credentials.get(name)` and nothing else. Authors bring their own HTTP client.
