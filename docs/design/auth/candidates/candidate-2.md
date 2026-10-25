# Platform bindings, unchanged credential calls

## Problem

HubSpot needs browser consent and token refresh, but Totem has no platform server or management identities. ADRs 0007 through 0009 already give the platform credential ownership and apps a single `credentials/get` call. Preserve that contract. Add management authentication and OAuth bindings inside `platform/`, without requiring every language SDK to implement provider flows.

## Usage (caller's view)

An operator registers the app, then configures its named credential. The app's manifest declares only its credential type and scopes. These are three caller views of the same connection.

```ts
// Platform operator code. Values arrive through authenticated setup, never the manifest.
const binding = await connections.configureOAuth({
	operator,
	app: hubspotRevision,
	name: "hubspot",
	client: { clientId, clientSecret },
	provider: {
		authorizationUrl: "https://app.hubspot.com/oauth/authorize",
		tokenUrl: "https://api.hubspot.com/oauth/v3/token",
		tokenFields: { accountId: "hub_id", scopes: "scopes" },
	},
});
// Register binding.redirectUri in the HubSpot developer app.
```

```ts
// Totem console handler. Session and install were resolved by the platform boundary.
const { authorizationUrl } = await connections.connect({ session, install, name: "hubspot" });
return Response.redirect(authorizationUrl, 303);
```

```ts
// HubSpot action handler. Credential type comes from the manifest literal.
const { accessToken } = await ctx.credentials.get("hubspot");
const response = await fetch(`https://api.hubapi.com/crm/v3/objects/contacts/${encodeURIComponent(input.contactId)}`, {
	headers: { authorization: `Bearer ${accessToken}` },
});
```

## Shape

### D1. The platform knows provider configuration

Yes, the platform must know OAuth URLs because it sends codes, refresh tokens, and client secrets to them. The operator supplies these public details alongside the client registration, keyed by app revision and credential name. The app author documents the required setup. The platform owns the approved configuration and executes it. There is no built-in provider catalog, provider name dispatch, app callback handler, or executable plugin.

The HubSpot manifest remains `{ hubspot: { type: "oauth2", scopes: [...] } }`. Provider URLs and client IDs do not belong in per-install `config`, which travels to the app. A small platform-only OAuth profile fixes the first grant to authorization code, form-encoded token requests, and `client_secret_post`. Its field names extract a scalar account ID and granted scopes. This supports HubSpot without a transformation language. Other grant and response formats are future platform changes, per laziness-protocol.

### D2. Keep the app protocol stable

`sketch/types.ts` copies the relevant protocol types. The credential declaration becomes an equivalent discriminated union, retaining ignored API-key scopes for compatibility. There are no wire changes or protocol-major changes. `CredentialFor` narrows the SDK's result by the manifest declaration, fixing the current need for app-side type checks. Every SDK still sends exactly `credentials/get { name }`, and OAuth returns exactly `{ type, accessToken, expiresAt }`.

`Connections` hides consent state, provider parsing, secret lookup, expiry, refresh, and concurrency. Callers supply a credential name and an authorized install or callback scope. They never coordinate refresh steps. Provider responses remain `unknown` until parsed inside this module. JSON Schema stays authoritative under ADR 0004, per boundary-discipline and type-system-discipline.

### D3. Management identities and app capabilities have separate authority

| Layer 1 concern | Owner and HubSpot slice | Deferred mechanism |
|---|---|---|
| Human login | Platform exchanges a provisioned management token for an opaque browser session. The development console has a token sign-in form. | An identity provider handles password login and account recovery. Its verified identity maps to a Totem principal. |
| SSO and MFA | Identity provider owns authentication factors. Neither is implemented in this local slice. | Add one OIDC login adapter with issuer, audience, signature, nonce, and authentication-strength checks. SAML can terminate at that provider. |
| Roles and permissions | Platform provisions operator and tenant-admin grants. Operators register apps and configure provider clients. Tenant admins install, connect, invoke, and disconnect within their tenant. | Add role-to-permission mappings and membership management behind the same management boundary. |
| Tenant isolation | Platform resolves installs by authenticated tenant and install ID. Credential records include tenant, install, and credential name. | Persistent storage must retain these composite keys and enforce the same checks. |
| Management API tokens | Platform stores only token digests, expiry, revocation, subject, and authority. CI gets a service subject, never an app callback token. | Add narrower token permissions before giving CI production registration access. |
| Audit logs | Platform appends actor, tenant, install, operation, result, and time for management mutations and connection outcomes. No credentials or callback query strings. | Durable append-only storage and retention policy. |
| Approval workflows | Direct role checks authorize this slice. | Add pending management commands and an approval gate before mutation, without changing app methods. |

Provisioning is server configuration for the development server, not a new public token-issuance API. Tokens are random, revocable, and time limited. Browser sign-in sends the token in a POST body over TLS, then uses an HttpOnly, SameSite=Lax cookie with CSRF checks on mutations. Secure cookies are mandatory outside localhost. No token enters a URL. Membership changes invalidate sessions. Provisioned management tokens are the explicit development login mechanism, not production SSO.

ADR 0008 stays unchanged. The per-app HMAC key authenticates platform requests to that app and grants no management authority. Callback tokens have their own audience and authenticate only the app callback endpoint. They bind tenant, install, app revision, expiry, and call or lifecycle scope. The platform checks declared needs and current install status. Management tokens and session cookies cannot authenticate callbacks. Callback tokens cannot register an app, configure clients, or start consent. User identities remain in the platform's call and audit records, rather than enlarging the invocation context. A HubSpot account ID never becomes a Totem tenant or login identity.

### D4. Store one connection per install and credential name

The in-memory store keys connections by `{ tenantId, installId, name }`. Each record references its immutable app revision and OAuth binding. Each consent attempt gets a separate random state, stored as a digest, and captures that record's generation. The platform binds the attempt to the initiating browser session, principal, exact callback path, and binding. It rechecks tenant authority and the install before exchanging the code.

The first successful callback atomically claims its state and conditionally replaces the captured generation. Duplicate, expired, canceled, cross-session, cross-binding, and stale callbacks fail closed. Reconnecting leaves the old connection usable until replacement succeeds. Disconnect increments the generation and deletes secrets, so a late callback or refresh cannot restore it. Concurrent reads share one refresh promise per connection because one refresh token is shared state. Refresh updates the latest refresh token and access token together. `invalid_grant` changes the record to reconnect-required. Transport failures return an error, and uncertain rotating-token outcomes require reconnect, per make-operations-idempotent.

### Connector coverage

Every deferred row names an additive change. Do not predeclare unused variants or methods in the sketch.

| Connector auth | Mechanism |
|---|---|
| OAuth 2.0 | Now. Authorization code plus refresh in `Connections`, with bearer access-token handoff. Add client-credentials, PKCE S256, or other grant variants to the platform profile when a provider needs them. |
| OIDC | Deferred, admitted additively by an OIDC grant profile that validates discovery, issuer, audience, signature, and nonce. Reuse OAuth access-token handoff. Add an ID-token result variant only when an action requires an ID token. |
| API keys | Now. Tenant admin submits a static secret and `credentials/get` returns `{ type: "apiKey", key }`. A HubSpot private-app token fits here for a separate single-account app declaration. |
| Basic auth | Deferred, admitted additively by `basic` declaration and value variants with username and password, plus the matching SDK inference. The app builds the Authorization header. |
| mTLS client certificates | Deferred, admitted additively by an `mtls` declaration and `http/fetch` driven port that performs TLS in the platform. Exclude this declaration from handoff names. |
| SSH keys | Deferred, admitted additively by an `ssh` declaration and `ssh/exec` driven port constrained to approved hosts. Exclude this declaration from handoff names. |
| Service accounts | Deferred, admitted additively by a platform client-credentials or signed-JWT grant profile. Keep the signing key in the platform and hand off expiring OAuth access tokens. Request-signing services use `http/fetch`. |
| Cloud IAM roles | Deferred, admitted additively by an assume-role binding and a `cloudSession` credential value with temporary access key, session token, and expiry. The app's cloud SDK signs requests. |
| Workload identity | Deferred, admitted additively by a workload-identity token-exchange binding that uses the platform deployment's federated identity. Return an existing OAuth value or the cloud-session variant. |
| Database usernames and passwords | Deferred, admitted additively by a `database` declaration and handoff value containing username and password. Connection settings remain install config. |

### Secret locations and consequences

All current records and secrets live in the platform process's private in-memory store. A secret reference never crosses the app protocol. Process compromise exposes every stored tenant secret. Restart loses connections and sessions. This slice makes no durability claim.

| Material | Location and permitted readers | Blast radius if leaked |
|---|---|---|
| Provider client ID | Platform OAuth binding. Operator, browser authorization request, and provider can read it. It is public. | No bearer authority by itself. |
| Provider client secret | Private platform secret store. Operator submits it once. OAuth engine reads it, and later the platform webhook verifier can read it. Never returned to apps or console reads. | Every tenant using that developer registration, subject to provider checks. |
| Refresh token | Private secret store per connection. Only the platform OAuth engine reads it and sends it to the configured provider. | One provider account and consented grant until revocation, with any required client authentication. |
| Access token | Private secret store, then the invoking app receives it through its scoped callback. Provider receives it in API calls. | Provider account and scopes until expiry. Totem disconnect cannot recall a token already handed off. |
| API key or private-app token | Tenant submits it to the private store. Its installed app receives it through `credentials/get`. | The key's provider permissions until rotation or revocation. |
| Tenant password, including basic and database | Deferred. Store per connection. Only the authorized app receives it when its new handoff variant ships. | That external account until password change. |
| Private key for mTLS, SSH, or signed service-account assertions | Deferred. Platform secret backend only. Transport or signing code uses it. Apps receive transport results or short-lived tokens. | The identities and targets covered by the key until revocation. |
| Management token, session, HMAC key, callback token | Management token digest only on server. Session secret only in browser cookie and session store. HMAC key in platform and app. Callback token in one invocation. | Respectively granted management authority, that browser session, authenticity for one registered app, or declared resources for one install and call until expiry. |

### HubSpot connect flow

1. A1. A developer creates a HubSpot OAuth app and configures the required contacts scopes. A Totem operator registers the deployed app URL. The platform issues its HMAC key through provisioning, calls signed `initialize`, and stores the returned manifest as an immutable revision.
2. A2. The operator submits the client ID, client secret, provider URLs, and `hub_id` mapping through authenticated setup. The platform returns a canonical callback such as `https://totem.example/oauth/callback/<bindingId>`. The developer registers that exact URL in HubSpot before enabling connections.
3. A3. Alice signs into the development console using her provisioned tenant-admin token. She installs the HubSpot revision in her tenant and clicks Connect. The console POSTs `/installs/<installId>/credentials/hubspot/connect` with its session cookie and CSRF token. The route supplies the session's tenant, never a browser-selected tenant.
4. A4. The platform creates the consent attempt and redirects to `https://app.hubspot.com/oauth/authorize?response_type=code&client_id=...&redirect_uri=...&scope=oauth%20crm.objects.contacts.read%20crm.objects.contacts.write&state=...`. Scope comes from the pinned manifest. No client secret appears in this URL.
5. A5. Alice selects her HubSpot account and grants access. HubSpot GETs the registered callback with `code` and `state`. The platform verifies the attempt, browser session, binding path, current authorization, and generation. A denial consumes the attempt and displays the error without changing a working connection.
6. A6. The platform POSTs a form to `https://api.hubspot.com/oauth/v3/token` containing `grant_type=authorization_code`, `client_id`, `client_secret`, `redirect_uri`, and `code`. It validates the response before atomically storing access token, expiry from `expires_in`, refresh token, granted scopes, and normalized `hub_id`. The console receives connected status and account ID, never tokens. The app receives no consent callback. [HubSpot's OAuth guide](https://developers.hubspot.com/docs/api-reference/legacy/authentication/manage-oauth-tokens) documents this exchange and response.
7. A7. Alice invokes `getContact` or `upsertContact`. The platform signs `actions/invoke` and includes an ADR 0008 callback token. The app calls `credentials/get { name: "hubspot" }`. The platform resolves the connection from that token and returns the existing OAuth credential value. The app calls HubSpot with its bearer token.
8. A8. Before expiry, `credentials/get` refreshes through the same token URL using `grant_type=refresh_token`, client credentials, and the stored refresh token. It returns only the current access token and expiry. The eventual webhook receiver belongs to the platform because signature verification needs the retained client secret. It can route verified events by binding and `hub_id` to matching installs. Webhook subscriptions and `events/emit` remain deferred.

HubSpot's documented confidential-client flow does not require PKCE. Preserve that exact flow for this slice, with transaction state and an exact redirect URI. Add S256 when the selected provider supports it. [OAuth security BCP](https://www.rfc-editor.org/rfc/rfc9700.html#section-2.1.1) recommends PKCE for confidential clients.

### Module map and validation

| Location | Responsibility |
|---|---|
| `protocol/src/types.ts` and existing schemas | Existing manifest and handoff contracts. No new auth RPC. |
| `sdk/javascript-sdk/src/types.ts` | Derive credential results from the manifest literal. |
| `platform/src/identity.ts` | Management tokens, browser sessions, tenant authority, and audit attribution. |
| `platform/src/connections.ts` | OAuth bindings, attempts, private secrets, account metadata, API keys, and fresh credential retrieval. |
| `platform/src/http.ts` | Parse requests, apply the appropriate management, session, or callback authenticator, and call those two modules. |
| `examples/hubspot` | Manifest and contacts actions only. |

An authenticated operator must approve provider URLs before client secrets become usable. Require HTTPS except an explicit localhost development callback. Reject userinfo, fragments, private-network token destinations, and token-endpoint redirects. Keep binding URLs immutable. Re-registering an app cannot redirect existing credentials to a new endpoint. New URLs require a new operator-configured binding and tenant reconnect. Validate manifests, management requests, callback claims, and provider responses at their boundaries. Check required scopes before publishing a connection. Keep any raw provider payload out of install config and logs.

## Synthesis decision

Candidate 2 proposes platform-configured bindings and an unchanged app wire contract. Selection and adaptations belong to the arena orchestrator. This candidate has not received the required independent cross-model review.

## Tradeoffs accepted

- D5. We accept one operator setup step per app credential in exchange for keeping untrusted manifests from choosing destinations for long-lived secrets.
- D6. We accept token handoff and its provider-account exposure in exchange for preserving ADR 0009 and ordinary HTTP clients.
- D7. We accept memory loss on restart and provisioned-token login in exchange for a small, usable development platform.

## Alternatives considered

- O1. Put OAuth URLs and token-response mappings in the manifest. The platform still hides refresh, but now registration and upgrade paths must validate changes to app-controlled secret destinations. Operator bindings keep that trust decision outside the app contract.
- O2. Let apps implement OAuth callbacks and refresh. The manifest is smaller, but every app and SDK must manage consent state, secrets, refresh races, and account routing. It also contradicts ADR 0009.
- O3. Proxy every provider request. This hides access tokens and private keys, but introduces a new HTTP protocol, request policy, streaming behavior, and an extra hop before HubSpot needs them. Add broker methods only for transport-bound credentials.

## Open questions and risks

- R1. When will this server need to survive restart? Before production, replace the in-memory identity and secret stores with durable, encrypted storage and recoverable OAuth transitions.
- R2. Will the same HubSpot account connect to multiple Totem installs? Keep grants per install now, and require explicit subscription and event-routing policy when webhooks ship.
- R3. Can CI accept the broad development operator grant? Introduce app-scoped registration permissions before issuing production automation tokens.

## Next implementation step

Build `platform/src/identity.ts` and `platform/src/connections.ts` against these signatures, then exercise one tenant's HubSpot connect, refreshed action call, and rejected cross-tenant callback.

## Compile verification

The caller checks also confirmed credential-name rejection, OAuth result narrowing, and mutual assignability with the existing protocol manifest and credential declarations. No repository files were changed.

Command:

```sh
/home/simon/development/totem/protocol/node_modules/.bin/tsc --noEmit --strict --target es2022 --module nodenext --moduleResolution nodenext --skipLibCheck /tmp/arena-auth/candidate-2/sketch/*.ts
```

Exit code: 0. Final compiler output, empty:

```text
```
