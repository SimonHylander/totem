# 0011: Platform access stays inside the platform

Status: Proposed (2026-10-25)

## Context

An integration platform has two auth layers. Platform access decides who may administer Totem: "Can Alice install an app for tenant acme?" or "Can this CI job register an app?" Connector auth decides how an app reaches the external system it integrates with. [0012](0012-oauth-provider-details-in-manifest.md) covers connector auth.

No platform access exists yet. ADR [0008](0008-methods-and-auth.md) covers only machine traffic: HMAC from the platform to an app, and a per-call callback token from an app to the platform. The HubSpot example needs a person to start an OAuth connect for one tenant's install, so the first platform needs some notion of who is acting.

## Decision

Platform access lives only in `platform/`. The protocol, the SDKs and apps never see users, roles or management tokens. An app still receives only `tenantId`, `installId` and `config`.

The HubSpot slice builds this minimum:

- **Management API tokens.** They are seeded from platform config and stored as SHA-256 digests. Each token resolves to a `Principal` (`{ id, role }`). Tokens are accepted only on `/api/*`.
- **Two roles.** `operator` runs the deployment, registers apps and sets OAuth clients. `tenantAdmin` is scoped to one `tenantId` and installs, connects and invokes within that tenant.
- **One check.** The rule is `can(principal, action)`. Every management function calls it before it acts, so a route cannot skip it. An install-scoped action carries the stored `Install` record, so the tenant that `can` compares always comes from the store and never from the request.
- **A browser session.** `POST /session` exchanges a management token for an HttpOnly, SameSite=Lax cookie, marked Secure outside localhost. Mutating routes that accept the cookie also check a CSRF token. OAuth consent needs it, because the provider redirect is a plain browser GET. The platform must know that the browser finishing a connect is the one that started it (RFC 6749 section 10.12).

These items are deferred. Each attaches to the same seams without changing the protocol.

| | Concern | Admitted by |
|---|---|---|
| L1 | Login and SSO | An identity provider. Totem becomes an OIDC relying party that maps the IdP subject and groups to a `Principal`. `can` and its callers do not change. |
| L2 | MFA | Identity provider policy. If needed, the login route rejects operator sessions whose `amr` claim lacks `mfa`. |
| L3 | More roles and RBAC | New `Role` members behind the same `can`. An `appMaintainer` role, scoped to one app, lets CI register new versions of that app only. |
| L4 | Token lifecycle | Issue, list, revoke and expiry operations on management tokens. |
| L5 | Audit log | Each management function appends `{ at, principal, action, allowed }` where it calls `can`. |
| L6 | Approval workflows | `can` returns `allow`, `deny` or `needsApproval` for chosen actions, plus a store of pending requests that a second principal approves. |

The credentials stay on separate doors:

| Credential | Identifies | Accepted at |
|---|---|---|
| Management token or session | A `Principal`: a person or a CI job | `/api/*`, `/oauth/*` |
| HMAC secret (0008) | The platform, to one app | The app |
| Callback token (0008) | One install and one call | The platform-methods endpoint |

A callback token fails at `/api/*`, and a management token fails at the platform-methods endpoint. Platform access decides what callback tokens can reach: a tenant admin creates installs and connections, and a callback token then reads only its own install's declared credentials.

## Rejected

- **The acting user in the protocol.** `CallContext` would carry a user so that apps could authorize per user. No planned app needs it, and every SDK would carry a platform-access concept.
- **A bootstrap principal that allows everything on localhost.** It is simpler, but it leaves tenant isolation untested until later. A two-role check costs one function.
- **Building login, SSO or MFA now.** These are bought from an identity provider. Building them first delays the HubSpot slice and adds nothing that slice exercises.

## Consequences

- Tenant isolation holds from the first slice, because every install-scoped check reads the tenant from the stored install.
- The in-memory store loses tokens, sessions and connections on restart. Persistent storage must keep the same record boundaries and encrypt sealed values at rest.
- An operator token can point a registered app at code it controls and collect access tokens as calls request them. Narrower operator roles (L3) reduce that exposure.
