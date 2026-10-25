# 0013: Ports bind to provider installs

Status: Accepted (2026-10-25)

## Context

An app declares ports in `needs.actions`: signatures it calls without naming a provider ([0007](0007-manifest.md)). The platform binds each port to a provider action at install time. Until now the platform answered every port call with `PortUnbound`, because nothing said what a binding names, when it is set, or how a call travels.

The first consumer is `examples/events`. Its `upsertContact` port should reach the tenant's HubSpot install.

## Decision

1. **A binding names a provider install and one of its actions.** For example, `{ installId: "<hubspot install>", action: "upsertContact" }`. Naming the install, not the app, keeps it unambiguous when a tenant has two installs of one app.
2. **Bindings are set when an install is created and are optional.** `POST /api/tenants/:tenant/installs` accepts `bindings: { [port]: { installId, action } }`, and `PUT /api/installs/:id/bindings/:port` sets or replaces one binding later. Calling an unbound port answers `PortUnbound` (-32003).
3. **The platform checks three things when it stores a binding.**
   - The port is declared in the consumer's manifest. Otherwise it answers 422.
   - The provider install belongs to the same tenant. Otherwise it answers 403.
   - The provider's manifest provides the action. Otherwise it answers 422.

   Schemas are not compared. Port compatibility stays an open question.
4. **A port call is forwarded as a normal action call.** When an app calls `actions/invoke { port, input }`, the platform invokes the bound action on the provider install. The provider gets its own install context, a new `callId` and its own callback token, so it reads only its own credentials. The provider's result or JSON-RPC error goes back to the caller unchanged. A HubSpot install that is not connected therefore surfaces in the consumer as `CredentialMissing`.
5. **Forwarding has a depth limit.** Each callback token carries the call depth. A port call from depth 8 fails with `InvalidRequest`, so a binding cycle cannot loop forever.

Deadline and idempotency-key propagation across a forwarded call are deferred.

## Rejected

- **Binding to a provider app.** The platform would pick the tenant's install of that app. It is ambiguous with two installs, and the choice would be hidden.
- **Requiring every port to be bound at install.** It forces an install order. An app can also run without an optional collaborator.
- **Exact schema equality.** It rejects compatible subsets, such as a port whose input lacks the provider's optional fields.

## Consequences

- Composition works end to end. One app drives another through the platform, and neither sees the other's credentials.
- An app depending on a port must handle the provider's errors, including `CredentialMissing` and `PortUnbound`.
- A binding can point at an action whose schema has drifted. The provider's input validation is the only guard until port compatibility is decided.
