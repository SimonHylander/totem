# Totem auth design: candidate 1

## Problem

Totem has two auth layers. Layer 1 decides who may administer the platform. Layer 2 decides how an app authenticates to the external system it integrates with. Layer 1 does not exist. Layer 2 exists only as the token handoff in ADR 0009, and nothing says where a provider's OAuth URLs or client credentials come from. The HubSpot slice needs a real OAuth connect, so that gap blocks the next example.

The shape must honor these constraints:

1. The protocol is the contract (ADR 0001). Each thing an app must implement costs one implementation per SDK.
2. Integrations are apps (ADR 0006). The protocol has no provider concept.
3. Client secrets and refresh tokens never leave the platform (ADR 0009).
4. Manifests come from third-party apps through `initialize` (ADR 0007). A manifest is the app author's claim, not the operator's.
5. TypeScript infers handler types from the manifest literal (ADR 0010).
6. HubSpot, per frame.md: consent at `https://app.hubspot.com/oauth/authorize`, code exchange at `https://api.hubspot.com/oauth/v3/token` with the client secret in the form body, 30-minute access tokens, refresh tokens that live until uninstall, and `hub_id` in the token response.

Constraints 2 and 3 pull against each other. The app knows the provider, but the platform must hold the secrets. Constraint 4 makes the obvious merge unsafe. If the platform trusts a token URL that the app declares, a malicious app can point it at its own server and collect the client secret and every refresh token.

## Key decisions

- D1. Layer 1 lives only in the new `platform/` package. The protocol, the SDKs and apps never see users, roles or management tokens.
- D2. Layer 1 for the slice is static management API tokens, two roles (`operator`, `tenantAdmin`) and one pure check, `can(principal, action)`. Login, SSO and MFA come from a bought identity provider later.
- D3. The app declares the provider's OAuth endpoints and scopes as manifest data. The platform runs one generic OAuth 2.0 authorization code flow from that data. The platform has no provider catalog.
- D4. The provider OAuth client (client ID and secret) is deployment config. An operator sets it for one credential of one app, and that act pins the manifest's endpoints, which means the platform copies them into the client record. The platform sends the client secret and refresh tokens only to pinned endpoints.
- D5. Secrets are write-only through the management API. Only `credentials/get` returns a credential, only to the app, and only for a declared need.
- D6. Deferred connector types arrive as new members of the `CredentialNeed` and `CredentialValue` unions, or as optional fields on `OAuth2Need`. The SDK types `credentials.get(name)` by the declared type, so a new member breaks no existing app.

## Usage (caller's view)

### App author

To use an OAuth API, declare the credential with the provider's endpoints and scopes, then call `ctx.credentials.get`. The platform runs consent, storage and refresh. Your app never sees a client secret or a refresh token.

```ts
// examples/hubspot/src/manifest.ts (full file: sketch/hubspot-manifest.ts)
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

```ts
// examples/hubspot/src/app.ts
getContact: async ({ email }, ctx) => {
  // The manifest declares oauth2, so this is the oauth2 value. No runtime type check.
  const { accessToken } = await ctx.credentials.get("hubspot");
  const res = await fetch(
    `https://api.hubapi.com/crm/v3/objects/contacts/${encodeURIComponent(email)}?idProperty=email`,
    { headers: { authorization: `Bearer ${accessToken}` } },
  );
  if (res.status === 404) return { contact: null };
  return { contact: toContact(await res.json()) };
},
```

```ts
// examples/hubspot/src/app.test.ts
const platform = fakePlatform(app, {
  credentials: { hubspot: { type: "oauth2", accessToken: "t", expiresAt: "2030-01-01T00:00:00Z" } },
});
```

### Operator

```sh
# Register the app (ADR 0007 and 0008, unchanged). The response carries the HMAC secret once.
curl -X POST $TOTEM/api/apps -H "authorization: Bearer $OPERATOR_TOKEN" -d '{"url":"http://localhost:3002"}'

# Set the HubSpot client for the app's `hubspot` credential. This pins the manifest's endpoints.
curl -X PUT $TOTEM/api/apps/hubspot/oauth-clients/hubspot -H "authorization: Bearer $OPERATOR_TOKEN" \
  -d '{"clientId":"<from HubSpot>","clientSecret":"<from HubSpot>"}'
# {"redirectUri":"http://localhost:4000/oauth/callback",
#  "authorizeUrl":"https://app.hubspot.com/oauth/authorize","tokenUrl":"https://api.hubspot.com/oauth/v3/token",
#  "scopes":["oauth","crm.objects.contacts.read","crm.objects.contacts.write"]}
```

### Tenant admin

```sh
curl -X POST $TOTEM/api/tenants/acme/installs -H "authorization: Bearer $ACME_TOKEN" -d '{"app":"hubspot","config":{}}'
# {"installId":"inst_1"}
curl -X POST $TOTEM/api/installs/inst_1/connections/hubspot/oauth -H "authorization: Bearer $ACME_TOKEN"
# {"authorizeUrl":"https://app.hubspot.com/oauth/authorize?response_type=code&client_id=...&state=..."}
# Open the URL in a browser and approve. Then:
curl -X POST $TOTEM/api/installs/inst_1/actions/getContact -H "authorization: Bearer $ACME_TOKEN" \
  -d '{"input":{"email":"ada@acme.com"}}'
```

### Platform code

```ts
// platform/src/routes.ts. The route authenticates. The operation authorizes itself.
route("POST /api/installs/:install/connections/:credential/oauth", (req) => {
  const principal = authenticate(store, bearerOf(req));
  if (!principal) return unauthorized();
  return beginOAuthConnect(store, principal, req.params.install, req.params.credential);
});

// The frame's two examples:
can(alice, { type: "install.create", tenantId: "acme" }); // true if Alice is operator or tenantAdmin of acme
can(ci, { type: "app.register" }); // true only for an operator token in the slice
```

## Shape

Three terms recur. A credential need is what the manifest declares. A connection is what the platform stores for one install and one need. A credential value is what `credentials/get` returns.

### Ownership split

Layer 1 belongs to the platform, with login delegated to an identity provider later.

| | Concern | Owner | Built now | Deferred, admitted by |
|---|---|---|---|---|
| L1 | Login and SSO | External identity provider. Totem is an OIDC relying party. | None. Management API tokens only. | An OIDC login route that maps the IdP subject and groups to a `Principal`. `can` and the operations stay as they are. |
| L2 | MFA | Identity provider | None | IdP policy. If needed, the login route rejects operator sessions whose `amr` claim lacks `mfa`. |
| L3 | Roles and permissions | Platform, `can` | `operator` and `tenantAdmin` | New `Role` members. `appMaintainer`, scoped to one app, lets a CI pipeline register new versions of that app only. Stored role definitions later, behind the same `can`. |
| L4 | Tenant isolation | Platform | `can` compares tenants from stored records. Connections nest in installs. Callback tokens name one install. | Nothing new. |
| L5 | Management API tokens | Platform | Seeded from config. Stored as SHA-256 hex. | Issue, list and revoke operations, and expiry. |
| L6 | Audit log | Platform | None | Each operation appends `{ at, principal.id, action, allowed }` where it calls `can`. `connections.ts` appends connect, refresh and delete events. |
| L7 | Approval workflows | Platform | None | `can` returns `"allow" \| "deny" \| "needsApproval"` for chosen actions, plus a store of requests that a second principal approves. |

Layer 2 splits by what each party knows.

| Party | Owns | Never sees |
|---|---|---|
| App author, through the manifest | The credential name, type, provider endpoints and scopes. Every call to the provider API. | Client ID, client secret, refresh token, redirect URI, `state` |
| Operator, through `setOAuthClient` | The OAuth client for each app credential, and so the pins. The provider's developer app config. | Tenant tokens and keys |
| Tenant admin, through the connect operations | Consent at the provider, or the API key | Any stored secret, including a key they entered |
| Platform | The flow, `state`, code exchange, sealed storage, refresh, handoff and need checks | Nothing about a provider beyond the manifest data |

The slice builds `oauth2` (authorization code with refresh) and keeps `apiKey`, which exists. The deferred types are in [Connector auth types](#connector-auth-types).

### Should the platform know OAuth URLs?

No. The platform knows OAuth 2.0 and the app knows HubSpot. The app declares the provider's endpoints and scopes in its manifest. The platform runs one generic authorization code flow from that data, after an operator pins the endpoints.

1. An app is the integration (ADR 0006). A provider catalog in the platform makes every new provider a platform change, and a third-party author waits on the platform team to ship.
2. Endpoints are data, not code. SDKs pass the manifest through, so the feature costs no SDK work in any language (ADR 0001).
3. The secrets stay in the platform (ADR 0009). The app says where the provider is. The operator approves it. The platform decides what is sent there.
4. Provider quirks become optional fields on `OAuth2Need`. Examples are `clientAuth: "basic"` for token endpoints that want HTTP Basic, `scopeSeparator`, `authorizeParams` for Google's `access_type=offline`, `pkce` and `revokeUrl`. Each is additive. HubSpot needs none of them.

The platform does hold HubSpot-specific values: the client ID and the client secret. They belong to a deployment, not to an app. HubSpot binds them to the redirect URLs in its developer app, and the redirect URL is the platform's.

### Data structures

The protocol change is one union, plus the `Endpoint` and `CredentialValueFor` helper types. `credentials/get` keeps its params and result, and the protocol gains no method.

```ts
type Endpoint = `https://${string}` | `http://localhost:${string}` | `http://localhost/${string}`;
type OAuth2Need = { type: "oauth2"; authorizeUrl: Endpoint; tokenUrl: Endpoint; scopes: readonly string[] };
type ApiKeyNeed = { type: "apiKey" };
type CredentialNeed = OAuth2Need | ApiKeyNeed;
type CredentialValueFor<N> = N extends { type: infer T } ? Extract<CredentialValue, { type: T }> : never;
```

The JSON Schema `credential` definition in `protocol/manifest.schema.json` mirrors it:

```json
"credential": { "oneOf": [
  { "type": "object", "required": ["type", "authorizeUrl", "tokenUrl", "scopes"], "additionalProperties": false,
    "properties": { "type": { "const": "oauth2" },
      "authorizeUrl": { "$ref": "#/$defs/endpoint" }, "tokenUrl": { "$ref": "#/$defs/endpoint" },
      "scopes": { "type": "array", "items": { "type": "string" } } } },
  { "type": "object", "required": ["type"], "additionalProperties": false,
    "properties": { "type": { "const": "apiKey" } } } ] },
"endpoint": { "type": "string", "format": "uri", "pattern": "^(https://|http://localhost[:/])" }
```

The SDK change is two lines in `sdk/javascript-sdk/src/types.ts`. It also makes the runtime type check in `examples/contacts/src/app.ts` unnecessary. Python and Go regenerate from the schema. No SDK gains runtime code.

```ts
type CredentialNeeds<M> = M extends { needs: { credentials: infer C } } ? C : Record<never, never>;
credentials: { get<K extends keyof CredentialNeeds<M> & string>(name: K): Promise<CredentialValueFor<CredentialNeeds<M>[K]>> };
```

The platform records are in `sketch/types.ts`, part 2. Each main access pattern uses only map lookups:

1. `credentials/get`, on every call: `claims.installId`, then `installs.get`, then `connections.get(name)`. The OAuth client is read only when a refresh is due.
2. The OAuth callback: `pendingConnects.get(state)`, delete it, `installs.get`, exchange the code, `connections.set`.
3. A management call: `apiTokens.get(sha256(bearer))` gives the `Principal`. The operation loads its target record and calls `can`.

The design keeps these invariants:

- I1. Secrets go only to pinned endpoints. `OAuthClient.pinned` is the operator's approval and the manifest endpoints are the app's proposal. Connect and refresh fail with 409 while they differ, until an operator sets the client again. Two writers keep two fields, and the platform compares them when it reads (per separate-before-serializing-shared-state). Scopes are not pinned. They steer no secret, and the tenant sees them on the provider's consent screen.
- I2. No management response carries a stored secret. Secrets are `Sealed`, and `reveal()` runs in two places: the token endpoint calls and `getCredential`.
- I3. The tenant in an authorization check comes from a stored record. Install-scoped `ManagementAction` members carry the `Install`, not a tenant string (per encode-lessons-in-structure).
- I4. A connection belongs to one install. Connections nest in `Install`, so deleting an install deletes them. The only path to a connection goes through the install that a callback token names.
- I5. A connection has at most one refresh in flight. `store.refreshes` uses the connection record as its key. A refresh writes back only if the install still holds the record it read, so a reconnect that lands during a refresh wins.
- I6. `state` is single-use and expires after 10 minutes. A replayed callback finds nothing (per make-operations-idempotent). `setOAuthClient` and `connectApiKey` are idempotent puts.
- I7. A connection serves only the need type it was made for. If a new manifest changes a credential's type, the old connection reads as missing.

Validation happens at two points (per boundary-discipline). The platform validates each manifest against the JSON Schema at registration, and accepts `http://localhost` endpoints only in development mode. The route parses the provider redirect into `CallbackQuery`. Code past those points trusts the types.

The module map keeps every request within three files: route, operation, store.

- `platform/src/access.ts`: `authenticate`, `can`, `Principal`, `ManagementAction`.
- `platform/src/connections.ts`: `setOAuthClient`, `beginOAuthConnect`, `finishOAuthConnect`, `connectApiKey`, `getCredential`.
- `platform/src/store.ts`: the records, `Sealed` and `seal`.
- `platform/src/routes.ts`: the HTTP shell for `/api/*`, `/oauth/callback` and the platform-methods endpoint.

The interface is deep. An app sees one call, `credentials.get(name)`, and four manifest fields. Behind them the platform hides the authorization request, `state`, the code exchange, client authentication, sealed storage, refresh before expiry, single-flight refresh, refresh token rotation, `invalid_grant` handling and pinning. Operators and tenant admins get three new operations: `setOAuthClient`, `beginOAuthConnect` and `connectApiKey`. The browser gets one callback route.

The design does not do these things:

- It has no provider catalog.
- It puts no layer 1 data in the protocol. `CallContext` has no user.
- It has no per-user connections and no connections shared across installs.
- It does not proxy external calls. The `http/fetch` port from ADR 0009 stays deferred.
- The slice has no PKCE, no token revocation at uninstall and no detection of scope changes. HubSpot's token endpoint reference lists `code_verifier`, so an optional `pkce: true` field can likely turn PKCE on for HubSpot later.

### Connector auth types

Long term, layer 2 has four credential types: `oauth2` and `apiKey` now, `secret` and `workloadIdentity` later.

| | Auth type | Mechanism | Status |
|---|---|---|---|
| C1 | OAuth 2.0 | `oauth2` need with app-declared endpoints and scopes. The platform runs the authorization code flow with the operator's client, stores and refreshes tokens, and hands out access tokens. | Now |
| C2 | OIDC | API access through an OIDC provider uses `oauth2` now, because the OIDC code flow is the OAuth 2.0 authorization code flow. The app declares the endpoints from the provider's discovery document. As platform login, OIDC is L1. | Now for API access. Deferred, admitted by an optional `idToken` field on the oauth2 value if an app needs the user's identity, and an optional `issuer` field for discovery. |
| C3 | API keys | `apiKey` need. The tenant enters the key, and `credentials/get` returns `{ type: "apiKey", key }`. | Now (exists) |
| C4 | Basic auth | `secret` need with a `fields` JSON Schema of `username` and `password`. The platform renders a form from `fields`, as it does for `config`. `credentials/get` returns the values. The TS SDK types them with `FromSchema`. | Deferred, admitted by a `secret` member in `CredentialNeed` and `CredentialValue` |
| C5 | mTLS client certificates | `secret` need with PEM `certificate` and `privateKey` fields | Deferred, admitted by the same `secret` member. The `http/fetch` proxy keeps the key in the platform if that is ever required. |
| C6 | SSH keys | `secret` need with `username`, `privateKey` and `hostKey` fields | Deferred, admitted by the same `secret` member |
| C7 | Service accounts | Accounts with a client ID and secret use the client credentials grant, through an `oauth2` member with `grant: "client_credentials"` and no `authorizeUrl`. The tenant enters the client at connect, and the result is the same oauth2 value. Accounts with a key file, such as a GCP JSON key, use `secret`. | Deferred, admitted by a second `type: "oauth2"` member discriminated by `grant`. Existing needs match the first member. |
| C8 | Cloud IAM roles | `workloadIdentity` need with an `audience`. The platform signs a short-lived OIDC token per call with `sub` set to the install. The tenant's cloud trusts the platform's issuer. The app exchanges the token at the cloud's STS, for example AWS `AssumeRoleWithWebIdentity`. The platform stores no cloud secret. | Deferred, admitted by a `workloadIdentity` member and a JWKS endpoint on the platform |
| C9 | Workload identity | Same mechanism as C8 | Deferred, same change as C8 |
| C10 | Database usernames and passwords | `secret` need with the connection fields | Deferred, admitted by the `secret` member |

The deferred members are additions. No existing manifest or handler changes:

```ts
type SecretNeed = { type: "secret"; fields: JSONSchema };
// value: { type: "secret"; values: Record<string, unknown> }. The TS SDK types `values` as FromSchema<fields>.
type WorkloadIdentityNeed = { type: "workloadIdentity"; audience: string };
// value: { type: "workloadIdentity"; idToken: string; expiresAt: string }
```

### Secrets

| | Secret | Lives in | Who can read it | Blast radius if it leaks |
|---|---|---|---|---|
| S1 | Provider client ID | `OAuthClient.clientId` | Operator writes it. The platform reads it. It is public by design, in every authorize URL. | None alone |
| S2 | Provider client secret | `OAuthClient.clientSecret`, sealed | The platform only. It goes only to the pinned `tokenUrl`. The operator cannot read it back. | With any refresh token, lasting access to that tenant's HubSpot. Alone, it forges HubSpot webhook signatures and redeems intercepted codes for every tenant of that app on this deployment. |
| S3 | Refresh token | `Connection.refreshToken`, sealed | The platform only. It goes only to the pinned `tokenUrl`. | Useless without S2. With S2, one tenant's HubSpot account at the granted scopes until uninstall. |
| S4 | Access token | `Connection.accessToken`, sealed | The platform, and the app process during calls that request it | One tenant's HubSpot account at the granted scopes for at most 30 minutes |
| S5 | API key | `Connection.key`, sealed | The platform, and the app during calls | One tenant's account at the provider until the tenant rotates the key |
| S6 | Tenant passwords (deferred `secret`) | The `secret` connection, sealed | Same as S5 | Same as S5 |
| S7 | Private keys for mTLS and SSH (deferred `secret`) | The `secret` connection, sealed | Same as S5 | Same as S5 |
| S8 | App HMAC secret (ADR 0008) | `AppRecord.hmacSecret` and the app's environment | The platform signs and the app verifies. | Forged calls to that app. They get no credentials, because the app's platform calls still need a real callback token. |
| S9 | Callback token signing key | `Store.callbackKey`, sealed | The platform only | The worst on the platform. The holder mints tokens for any install and reads every connected credential through `credentials/get`. |
| S10 | Management API token | The holder keeps it. The platform keeps its SHA-256 in `Store.apiTokens`. | The holder | An operator token runs the whole deployment. It can point an app at code it controls and collect access tokens and API keys as calls request them. It cannot read stored secrets or re-pin without the client secret. A tenant admin token reaches one tenant's installs and connections and reads no secret. |
| S11 | OAuth `state` | `Store.pendingConnects`, 10 minutes, single use | Anyone who sees the authorize URL | Whoever completes consent with it chooses which provider account connects to that install. See R1. |
| S12 | Platform OIDC issuer key (deferred `workloadIdentity`) | A new sealed field on `Store` | The platform only | Every tenant cloud role that trusts the issuer |

The store is in memory in the slice. When it persists, the platform encrypts sealed values at rest with a KMS key.

### HubSpot connect flow

Once per deployment:

1. The operator creates a HubSpot developer app. In its auth settings they add the redirect URL `https://totem.example.com/oauth/callback`, or `http://localhost:4000/oauth/callback` in development, and the required scopes `oauth`, `crm.objects.contacts.read` and `crm.objects.contacts.write`. HubSpot shows the client ID and client secret.
2. The operator registers the Totem app with `POST /api/apps { url }`. The platform issues the HMAC secret, the app runs with it as `TOTEM_APP_SECRET`, and the platform calls `initialize` and stores the manifest. This step is ADR 0007 and 0008, unchanged.
3. The operator calls `PUT /api/apps/hubspot/oauth-clients/hubspot { clientId, clientSecret }`. The platform checks that `needs.credentials.hubspot` is an oauth2 need, seals the secret and pins `authorizeUrl` and `tokenUrl`. It returns `redirectUri`, the pinned endpoints and the scopes, and the operator checks them against step 1.

Once per install:

4. Alice holds a `tenantAdmin` token for tenant `acme`. She calls `POST /api/tenants/acme/installs { app: "hubspot", config: {} }`. `can` allows it. The platform stores `inst_1` and calls the app's `install` hook if the app has one. The hook can use no credential, because none is connected yet.
5. Alice calls `POST /api/installs/inst_1/connections/hubspot/oauth`. The platform loads `inst_1`, calls `can` with that install, checks the pins and stores a pending connect under a random 32-byte `state`. It returns this URL: `https://app.hubspot.com/oauth/authorize?response_type=code&client_id=<id>&redirect_uri=https%3A%2F%2Ftotem.example.com%2Foauth%2Fcallback&scope=oauth%20crm.objects.contacts.read%20crm.objects.contacts.write&state=<state>`.
6. Alice opens the URL. HubSpot asks her to log in and choose a HubSpot account, then shows the consent screen for the operator's HubSpot app. She clicks **Connect app**.
7. HubSpot redirects her browser to `https://totem.example.com/oauth/callback?code=<code>&state=<state>`.
8. The platform takes and deletes the pending connect. It checks that `inst_1` still exists and the pins still match. It calls `POST https://api.hubspot.com/oauth/v3/token` with the form body `grant_type=authorization_code`, `code`, `redirect_uri`, `client_id` and `client_secret`, and with redirects refused.
9. HubSpot returns `access_token`, `refresh_token`, `expires_in` of 1800, `hub_id` and `scopes`. The platform stores an oauth2 connection on `inst_1` under `hubspot`: both tokens sealed, `expiresAt` set to now plus `expires_in`, and `hub_id` and `scopes` in `providerFields`. Alice's browser shows a page that says HubSpot is connected for `acme`.
10. The app sees nothing during steps 4 to 9.

Per call:

11. Alice calls `POST /api/installs/inst_1/actions/upsertContact`. Later, a workflow makes this call instead. The platform signs `actions/invoke { action, input, context, callbackToken }` with `X-Totem-Signature` and sends it to the app. The context holds `tenantId: "acme"`, `installId: "inst_1"` and a `callId`.
12. The handler calls `ctx.credentials.get("hubspot")`. The SDK sends `credentials/get { name: "hubspot" }` with `Authorization: Bearer <callbackToken>`.
13. The platform verifies the token and loads `inst_1`. It checks the need (`NotDeclared`, -32001) and the connection (`CredentialMissing`, -32002). If less than 5 minutes remain on the access token, it first refreshes at the pinned token URL with `grant_type=refresh_token`. It returns `{ type: "oauth2", accessToken, expiresAt }`.
14. The app calls `https://api.hubapi.com/crm/v3/objects/contacts/...` with `Authorization: Bearer <accessToken>`. That value is all the app ever sees of auth.
15. If a refresh returns `invalid_grant`, because someone uninstalled the HubSpot app from the account, the platform deletes the connection and returns `CredentialMissing`. Alice repeats step 5.

The later `contactCreated` trigger routes webhooks by `portalId`. Step 9 already stores `hub_id`, so existing connections need no reconnect.

### Layer 1 identities and ADR 0008

Each endpoint accepts exactly one kind of credential.

| Credential | Identifies | Issued by and to | Accepted only at | Relation to layer 1 |
|---|---|---|---|---|
| Management API token | A `Principal`, which is a person or a CI job | Platform config, to an operator or a tenant admin | `/api/*` | It is the layer 1 identity. |
| OAuth `state` | One pending connect | The platform, inside the authorize URL | `/oauth/callback` | Records `startedBy`. Carries no rights after use. |
| HMAC secret, sent as `X-Totem-Signature` | The platform, to one app | The platform at registration, to the app | The app | `app.register`, an operator action, issues it. |
| Callback token | One install and one call | The platform per call, to the app | The platform-methods endpoint | None. It is a workload identity derived from the install. |

1. Layer 1 identities never reach an app. Alice's identity stops at the management API. The callback token minted for her `install.invoke` names the install, not Alice.
2. The two bearer tokens are disjoint. A callback token fails at `/api/*`, and a management token fails at the platform-methods endpoint. The types say the same. Management operations take a `Principal`, and `getCredential` takes `CallbackClaims`.
3. Layer 1 decides what callback tokens can reach. A tenant admin creates installs and connections. A callback token then reads only its own install's connections, and only the names the manifest declares, which is the ADR 0007 permission model.
4. ADR 0008 does not change.

## Synthesis decision

Filled in by arena.

## Tradeoffs accepted

- T1. We accept that an operator must set the OAuth client again when an app changes its endpoints, in exchange for the guarantee that the client secret and refresh tokens reach only endpoints an operator approved.
- T2. We accept per-install connections, so a tenant with two HubSpot apps connects twice, in exchange for no credential binding model yet. Tenant-wide connections can later bind at install time, as ports do in ADR 0007.
- T3. We accept that two apps for one provider repeat its endpoints, in exchange for a platform with no provider catalog.
- T4. We accept static tokens and two roles, in exchange for no identity infrastructure until an identity provider is bought.
- T5. We accept that an authorize URL is a bearer link for 10 minutes, in exchange for no browser sessions in the slice. See R1.
- T6. We accept a breaking change to the oauth2 need (required `authorizeUrl`, `tokenUrl` and `scopes`), in exchange for a union whose members each check their own required fields. No oauth2 manifest exists yet, so nothing breaks.
- T7. We accept that static secrets reach the app during calls, as ADR 0009 does for API keys, in exchange for no proxy. That later covers passwords and private keys too.

## Alternatives considered

- O1. A provider catalog in the platform: the manifest says `{ provider: "hubspot" }` and a platform registry holds the endpoints, as in Nango and Pipedream. App authors see less, but every new provider becomes a platform change, an author cannot ship until the catalog has their provider, and the protocol gains a provider concept against ADR 0006. A catalog can still arrive later as an operator tool that fills manifest fields, with no protocol change.
- O2. The app runs OAuth. It implements methods such as `oauth/authorizeUrl` and `oauth/exchange`, holds the client secret and hands tokens to the platform. The platform side looks small, but every SDK grows OAuth code, every app holds the client secret, and refresh needs a platform-to-app call inside `credentials/get`. It breaks ADR 0009.
- O3. The operator types the endpoints. The manifest says only `{ type: "oauth2", scopes }`. It is safe by construction, but each operator must research each provider, and every deployment repeats the same URLs. Pinning gives the same safety with the app's endpoints as the default.
- O4. Proxy first. Every external call goes through an `http/fetch` port and no credential reaches the app. It isolates best and keeps private keys safe, but it adds a hop per call, complicates streaming and large bodies, and adds a driven port to every SDK. ADR 0009 rejected it for now and keeps it additive.
- O5. Layer 1 in the protocol. `CallContext` carries the acting user so apps can authorize per user. No planned app needs it, and every SDK would carry a layer 1 concept.

## Open questions and risks

- Q1. Who owns the provider developer app in production? This design assumes the operator, so HubSpot's consent screen shows the platform's brand. If app authors must own it, an `appMaintainer` role may call `setOAuthClient` for its own app, and nothing else changes.
- Q2. HubSpot signs webhooks with the client secret, which never leaves the platform. Should the trigger ADR verify webhooks in the platform, or add an HMAC verify port that apps call? Handing the secret to the app would break ADR 0009.
- Q3. Is a 10-minute bearer authorize URL acceptable until web login exists? See R1.
- Q4. When a new app version adds scopes, should the platform mark existing connections as needing a reconnect? This belongs with the version-negotiation open question.
- Q5. Should one credential accept alternative types, such as HubSpot OAuth or a private app token? This design says no. A tenant with one HubSpot account still uses OAuth.
- R1. Without browser sessions, whoever completes consent with an authorize URL chooses the connected account. An attacker can send a tenant admin of another tenant an authorize URL for the attacker's own install, and receive that tenant's HubSpot tokens if the victim approves. Web login closes the gap by binding `state` to the initiator's session cookie (RFC 6749 section 10.12). `PendingConnect` gains one field.
- R2. A compromised remote app sees the access tokens and API keys of every install it serves, as calls request them (ADR 0009). The `http/fetch` proxy is the fix if that becomes unacceptable.
- R3. The single-flight refresh holds only within one process. A second platform instance needs compare-and-set on the connection record. Without it, providers that rotate refresh tokens will break connections.
- R4. HubSpot does not document `response_type=code` on its authorize URL. The platform sends it because RFC 6749 requires it. The first live connect confirms that HubSpot accepts it.

## Next implementation step

Change `CredentialNeed` to the `oauth2` and `apiKey` union in `protocol/src/types.ts` and `protocol/manifest.schema.json`, then build `platform/src/connections.ts` against a fake HubSpot token endpoint in vitest.

## Compile output

The command prints nothing and exits with code 0:

```
$ /home/simon/development/totem/protocol/node_modules/.bin/tsc --noEmit --strict --target es2022 --module nodenext --moduleResolution nodenext --skipLibCheck /tmp/arena-auth/candidate-1/sketch/*.ts
$ echo $?
0
```

`sketch/checks.ts` holds the compile-time checks: `credentials.get("hubspot")` narrows to the oauth2 value, an oauth2 need requires `tokenUrl`, endpoints must be https or localhost, and an apiKey need rejects `scopes`. I mutated each check once, and each mutation failed the compile.

Other candidates may hit one trap. Imported by absolute path, `json-schema-to-ts` cannot resolve its `ts-algebra` dependency, and `--skipLibCheck` hides the error, so `FromSchema` silently becomes `any`. The sketch uses only `JSONSchema`, which does not depend on `ts-algebra` and still rejects bad schemas. A separate run imported the package through its pnpm store path, without `--skipLibCheck`, and compiled the real `sdk/javascript-sdk/src/types.ts` with the one-line change against both the HubSpot and the contacts manifests. Inputs, outputs and credentials were all typed.
