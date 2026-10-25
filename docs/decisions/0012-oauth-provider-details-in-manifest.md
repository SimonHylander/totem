# 0012: Apps declare provider details, the platform runs generic OAuth

Status: Accepted (2026-10-25)

## Context

ADR [0009](0009-credentials-token-handoff.md) says the platform owns OAuth flows, storage and refresh, and that client secrets and refresh tokens never leave the platform. It does not say where a provider's authorize URL, token URL and client credentials come from. The manifest declares only `{ type: "oauth2", scopes }`.

The open question is whether the platform should know integration-specific details such as HubSpot's URLs, or whether the app should own them.

There are three constraints:
- An integration is an app (ADR [0006](0006-integrations-are-apps.md)). So a provider catalog in the platform makes every new provider a platform change.
- The platform sends the client secret and refresh tokens to the token URL.
- A manifest is a third-party app's claim (ADR [0007](0007-manifest.md)). If the platform trusted a token URL that an app declares, a malicious app version could point it at its own server and collect every refresh token.

## Decision

The app owns the provider details. The platform owns the secrets and the flow. The platform knows OAuth 2.0 and holds no provider code.

1. **The manifest declares the provider's endpoints.** An oauth2 credential need carries `authorizeUrl`, `tokenUrl` and `scopes`. An endpoint is https, or http on localhost in development mode. The platform parses each endpoint at registration and checks the real hostname.

   ```ts
   needs: {
   	credentials: {
   		hubspot: {
   			type: "oauth2",
   			authorizeUrl: "https://app.hubspot.com/oauth/authorize",
   			tokenUrl: "https://api.hubspot.com/oauth/v3/token",
   			scopes: ["oauth", "crm.objects.contacts.read", "crm.objects.contacts.write"],
   		},
   	},
   },
   ```

2. **An operator binds a client and pins the endpoints.** The client ID and secret come from the provider developer app. `setOAuthClient` stores them as an immutable binding, together with a copy of the manifest's endpoints. The platform sends secrets only to a binding's pinned endpoints. Each provider gets its own redirect URI, `<platform>/oauth/callback/<id>`, where `id` is a hash of the pinned endpoints. That keeps it stable across restarts, so it can be registered at the provider ahead of time. `setOAuthClient` returns it. The callback rejects a code that arrives on another provider's path. Without this per-provider redirect URI, a malicious provider could relay a HubSpot code to its own token URL (RFC 9700 section 4.4, mix-up attacks).
3. **Grants belong to their binding.** Each connection records the binding that issued it. The same client ID and endpoints rotate the secret in place. A new client ID or new endpoints create a new binding. Connections under the old binding then read as `CredentialMissing` until the tenant reconnects, so an old refresh token never reaches a new endpoint. A manifest whose endpoints no longer match the pin blocks new connects with 409 until an operator sets the client again.
4. **Consent is bound to the browser.** A tenant admin starts a connect from a signed-in session ([0011](0011-platform-access.md)). The pending `state` records that session. The callback requires the same session and rechecks `can` before it exchanges the code. Without this binding, an attacker could send their own install's consent URL to another tenant's admin and capture that admin's HubSpot account.
5. **The app sees only the token.** `credentials/get` and its result are unchanged. The platform refreshes the token before returning it when less than 5 minutes remain. A refresh writes only if the connection it read is still stored. That rule covers the delete on `invalid_grant` too, so a slow failed refresh cannot remove a reconnect that landed meanwhile. The TypeScript SDK types `credentials.get(name)` by the declared need through `CredentialValueFor`, so the HubSpot handler reads `accessToken` with no runtime type check.
6. **Provider-specific response fields are kept.** The platform stores token response fields other than the tokens, such as HubSpot's `hub_id`, on the connection without interpreting them. The later webhook trigger routes by `hub_id`.

The client secret is HubSpot's webhook signing key. Webhook verification therefore belongs to the platform when triggers arrive, and the secret is never handed to the app.

### Connector auth types

| | Type | Mechanism |
|---|---|---|
| C1 | OAuth 2.0, authorization code | Now. The flow in this decision. |
| C2 | OIDC | Now, for API access. The OIDC code flow is the OAuth 2.0 code flow. Deferred for identity: an optional `idToken` on the oauth2 value, with full ID token validation (issuer, audience, expiry, nonce, signature). |
| C3 | API keys | Now. It exists today. `{ type: "apiKey" }`. The tenant admin enters the key. |
| C4 | Basic auth | Deferred. Add a `secret` need with a `fields` JSON Schema (`username`, `password`). The platform renders the form from `fields`, as it does for `config`. |
| C5 | mTLS client certificates | Deferred. Use a `secret` need with PEM fields. If the private key must stay in the platform, use the `http/fetch` proxy from 0009. |
| C6 | SSH keys | Deferred. Use a `secret` need with `username`, `privateKey` and `hostKey` fields. |
| C7 | Service accounts | Deferred. A client ID and secret use `grant: "client_credentials"` on an oauth2 need with no `authorizeUrl`. Key-file accounts that sign a JWT assertion use a `jwt-bearer` grant that the platform signs, so the key stays in the platform. |
| C8 | Cloud IAM roles | Deferred. Add a `workloadIdentity` need with an `audience`. The platform signs a short-lived OIDC token whose `sub` is the install. The app exchanges it at the cloud's STS, for example with AWS `AssumeRoleWithWebIdentity`. The platform stores no cloud secret. |
| C9 | Workload identity | Deferred. It uses the same mechanism as C8. |
| C10 | Database usernames and passwords | Deferred. Use a `secret` need with the connection fields. |

Each deferred row adds a member to the `CredentialNeed` and `CredentialValue` unions, or an optional field on the oauth2 need. Existing manifests and handlers do not change. Optional oauth2 fields also cover provider quirks:
- `clientAuth: "basic"` for token endpoints that want HTTP Basic, such as Notion's.
- A JSON body for the token request.
- `pkce`.
- Extra authorize parameters, such as Google's `access_type=offline`.

HubSpot needs none of them.

### Protocol version

The change makes `authorizeUrl`, `tokenUrl` and `scopes` required on oauth2 needs, and removes `scopes` from apiKey needs. `protocol/README.md` says breaking changes bump the major. This decision keeps protocol `1`, because no app outside this repository speaks protocol 1, and no app in it declares oauth2. Protocol 1 stays open to breaking changes until the first external app ships. From then on, the README rule applies.

## Rejected

- **A provider catalog in the platform** (`{ provider: "hubspot" }`). App authors see less. In exchange, every new provider becomes a platform release, and the protocol gains a provider concept against 0006. A catalog can still arrive later as an operator tool that fills manifest fields.
- **The operator enters the endpoints, and the manifest stays `{ type, scopes }`.** It is safe without a pin, but the provider knowledge moves out of the app into setup docs that every deployment repeats. Pinning gives the same safety and keeps the app self-describing.
- **The app runs OAuth.** Every SDK would grow consent, callback and refresh code, and every app would hold the client secret, which breaks 0009.
- **A proxy for every external call.** It isolates best and keeps private keys in the platform. 0009 already defers it as an additive `http/fetch` port.

## Consequences

- Adding Salesforce or Notion is a manifest entry plus an operator binding. No platform code changes, unless the provider needs one of the optional quirk fields.
- An operator must set the OAuth client again when an app changes its endpoints, and tenants then reconnect. That is the cost of sending secrets only to approved endpoints.
- Connections are per install. A tenant with two HubSpot apps connects twice.
- The platform runs as one process. Running more than one needs a cross-process lock around each refresh request, not only a conditional write. Otherwise two processes redeem the same refresh token, which breaks providers that rotate refresh tokens.
- A new app version that adds scopes does not invalidate existing connections yet. Tenants keep tokens without the new scopes until they reconnect. This belongs with the version-negotiation open question.
