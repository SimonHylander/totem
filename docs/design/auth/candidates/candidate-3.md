# Auth design

## Problem

Totem has to authenticate two different populations. Operators administer the platform. Apps call external systems on a tenant's behalf. ADR 0008 already covers the machine channel between platform and app (HMAC one way, a per-call callback token the other). ADR 0009 already says the platform owns OAuth storage and refresh, and that a client secret and a refresh token never leave the platform. Nothing yet says where a provider's URLs and client id come from, and there is no user, role, or management token at all.

The HubSpot example needs a real authorization-code connect: browser consent, a code exchange at `https://api.hubspot.com/oauth/v3/token`, a 30-minute access token, and a refresh token that lives until uninstall. The CRM calls themselves stay in the app. The manifest credential shape is the part that is expensive to undo, because every SDK will follow it. Login is the part that can wait.

The platform does not learn HubSpot. The app declares the provider recipe. The platform runs one RFC 6749 authorization-code client against a pin of that recipe, and it supplies the redirect URL, the client id, and the client secret.

## Usage (caller's view)

An app author writes the recipe next to the actions. They never handle a redirect, a refresh, or a client secret. The full manifest is `sketch/hubspot-manifest.ts`.

```ts
needs: {
  credentials: {
    hubspot: {
      type: "oauth2",
      authorizeUrl: "https://app.hubspot.com/oauth/authorize",
      tokenUrl: "https://api.hubspot.com/oauth/v3/token",
      scopes: ["crm.objects.contacts.read", "crm.objects.contacts.write"],
    },
  },
},
```

The handler asks for a token and calls HubSpot. The CRM host is app code, because the app is the component that speaks CRM.

```ts
import { defineApp } from "@totem/sdk";
import { manifest } from "./manifest.js";

export const app = defineApp(manifest, {
  actions: {
    upsertContact: async (input, ctx) => {
      const credential = await ctx.credentials.get("hubspot");
      if (credential.type !== "oauth2") throw new Error("hubspot credential must be oauth2");

      const response = await fetch("https://api.hubapi.com/crm/v3/objects/contacts", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${credential.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          properties: {
            email: input.email,
            firstname: input.firstName,
            lastname: input.lastName,
          },
        }),
      });
      const body = (await response.json()) as { id: string };
      return { contactId: body.id };
    },
    getContact: async (input, ctx) => {
      const credential = await ctx.credentials.get("hubspot");
      if (credential.type !== "oauth2") throw new Error("hubspot credential must be oauth2");
      const response = await fetch(
        `https://api.hubapi.com/crm/v3/objects/contacts/${encodeURIComponent(input.contactId)}?properties=email,firstname,lastname`,
        { headers: { Authorization: `Bearer ${credential.accessToken}` } },
      );
      const body = (await response.json()) as {
        id: string;
        properties: { email: string; firstname?: string; lastname?: string };
      };
      return {
        contactId: body.id,
        email: body.properties.email,
        firstName: body.properties.firstname,
        lastName: body.properties.lastname,
      };
    },
  },
});
```

The operator connects a tenant through the management shell. Each call is one finished step. The shell is one route per function and is the only HTTP an operator hits. `principal` is the bootstrap operator until an identity provider exists.

```ts
const { appId, hmacSecret } = await registerApp({ principal, url: appUrl });
// hmacSecret is shown once and placed in the app process. The platform keeps the signing copy.

await putOAuthClient({
  principal,
  appId,
  name: "hubspot",
  clientId,
  clientSecret,
  authorizeUrl: "https://app.hubspot.com/oauth/authorize",
  tokenUrl: "https://api.hubspot.com/oauth/v3/token",
  scopes: ["crm.objects.contacts.read", "crm.objects.contacts.write"],
});

const install = await installApp({ principal, tenantId: "acme", appId, config: {} });
const { authorizeUrl } = await startConnect({
  principal,
  installId: install.installId,
  name: "hubspot",
});
// The shell responds 302 to authorizeUrl.
// HubSpot redirects the browser to /oauth/callback?code&state, which calls:
await completeConnect({ code, state });
```

On the data path the platform verifies the callback token and projects the grant. The principal is not an argument.

```ts
async function credentialsGet(authorization: string, name: string): Promise<CredentialValue> {
  const claims = verifyCallbackToken(authorization); // CallbackTokenClaims
  return issueCredential(claims.installId, name);
}
```

`credentials/get` still returns `{ type: "oauth2", accessToken, expiresAt }` or `{ type: "apiKey", key }`. The contacts app's `{ type: "apiKey" }` need still typechecks. Its operator pastes the key with `putApiKey`.

## Shape

Two platform modules sit behind a thin management shell. `access` knows who may administer. `registry` knows apps, installs, pins, and grants. The protocol stays the contract between app and platform.

The load-bearing records:

- `OAuth2Need` is `authorizeUrl`, `tokenUrl`, and optional `scopes`. `ApiKeyNeed` is only `type: "apiKey"`. A secret cannot appear in a need, and an API key cannot carry a token URL, because they are different members of `CredentialNeed`.
- `OAuthClient` is the pin: client id, client secret, and the recipe the operator submitted. `putOAuthClient` stores it only when that recipe equals the manifest. Token requests read the pin.
- `OAuth2Connection` stores the provider's token JSON once, plus `receivedAt`. `expiresAt` is derived from `receivedAt` and `expires_in`. HubSpot's `hub_id` stays inside that JSON.
- `CredentialValue` is the projection `issueCredential` returns. It is a different type from `Connection`, so a refresh token cannot be returned by accident.
- `CallbackTokenClaims` is `kind: "callback"`, `installId`, `exp`, and an optional `callId`. It has no principal and no tenant. Tenant is loaded from the install.
- `Principal` is `{ id }`. Login method is not a field.

Those separations are the invariants in the types. `acceptManifest` is the only syntax check on a manifest (https provider URLs, non-empty scope strings), and `completeConnect` is the only check of the browser query. After that the registry trusts the stored records. Drift between the live manifest and the pin is derived by comparing them, so it is not a second stored flag.

Refresh is the one place a per-actor copy would be wrong. The provider holds one refresh token for the install. Concurrent `credentials/get` calls share one refresh in flight per `(installId, name)` and then read the record that flight wrote. Callers do not merge their own token caches.

### Ownership

**Layer 1, platform access.** The platform owns it, outside the protocol. Apps never see a user, a role, or a management token. `tenantId` on the install context remains the only identity an app receives.

Built now, because the connect click needs an actor and the in-memory server needs a place to put a stricter check later:

- `Principal` and `can(principal, action, tenantId)`.
- One bootstrap principal. Localhost management routes attach it. `can` returns true for that id. There is no password, SSO, MFA, role table, audit log, or approval queue.
- `createdBy` on the app and the install, holding the principal id. It is not copied into the install context.

Deferred, admitted without a protocol change:

- SSO, MFA, and passwords: an authenticator in `access` that returns a `Principal`. Totem stores no password of its own once an identity provider does this.
- RBAC: the body of `can`. Signatures stay. `tenantId` is already an argument, so tenant isolation is a policy change.
- API tokens for CI: a hashed secret the authenticator resolves to a `Principal`. Presented only to management routes.
- Audit: append a record inside the management functions. `createdBy` is already on the rows they write.
- Approval: a queue in front of those same functions. `can` stays boolean.

**Layer 2, connector auth.** The app owns the declaration of how its vendor authenticates. The platform owns execution, storage, and refresh. The operator owns the deployment secrets. This split follows ADR 0006 (an integration is an app) and ADR 0009 (token handoff).

Built now for HubSpot:

- Authorization-code OAuth, pinned per app registration, one client shared by every install of that app.
- The existing API-key path, including a HubSpot private-app token on a manifest that declares `apiKey` instead of `oauth2`. This example does not. Multi-account HubSpot is OAuth.
- `issueCredential` as the body of `credentials/get`, with refresh inside 60 seconds of expiry.

Deferred: the table below. None of them change `credentials/get`'s oauth2 or apiKey results except the rows that add a new `CredentialValue` member, and those members are additive unions.

### Where provider details live

The app's manifest carries the non-secret provider recipe: authorize URL, token URL, scopes. `putOAuthClient` stores the client id and client secret only when the URLs and scopes in that call equal the manifest. The call is the operator accepting the destination the secret may be sent to, and a manifest published a moment later cannot change what was accepted. A later `initialize` may update action schemas freely. It does not move the pin. Until the operator calls `putOAuthClient` again, token requests keep the previous URLs, so a rewritten `tokenUrl` cannot receive the client secret.

The redirect URI is the platform's own `{origin}/oauth/callback` (`OAUTH_CALLBACK_PATH`). One path for the deployment. The operator registers that exact URL on the HubSpot app. Provider URLs in the manifest must be https. The platform's own callback may be `http://localhost` in development, which HubSpot allows.

The platform therefore knows a generic authorization-code client: where to send the browser, where to post the code, and where to post a refresh. The CRM URL stays in the app. `hub_id` stays in the raw token JSON. Webhook verification, later, reads the pinned client secret. There is no provider catalog and no HubSpot module to add a connector to.

Client id and client secret are deployment configuration. The same app artifact runs in more than one deployment. `initialize` returns the manifest, and that document will be logged and shown in an admin UI, so the secret stays out of it. The operator enters the client id with the secret. The browser already sees the client id on the authorize redirect.

### Connector mechanisms

| Auth type | Mechanism |
| --- | --- |
| OAuth 2.0 | Now for authorization code: `OAuth2Need` (`authorizeUrl`, `tokenUrl`, `scopes?`), the pin, `startConnect`, `completeConnect`, and refresh inside `issueCredential`. Other grants are deferred, admitted additively by a `grant` discriminant. A missing `grant` stays authorization code, so the HubSpot manifest stays valid. `credentials/get` still returns the oauth2 access token. |
| OIDC | Deferred, admitted additively by an optional `issuer` string on `OAuth2Need`. The platform checks `id_token.iss`. The app still receives only `{ accessToken, expiresAt }`. |
| API keys | Now. `ApiKeyNeed`, `putApiKey`, `{ type: "apiKey", key }`. A HubSpot private-app token uses this declaration. |
| Basic auth | Deferred, admitted additively by `{ type: "basic" }` on `CredentialNeed` and `{ type: "basic", username, password }` on `CredentialValue`. Pasted per install, same shape as `putApiKey`. |
| Database username and password | Deferred, admitted additively by that same `basic` variant. The app builds a DSN or an HTTP Basic header. |
| mTLS client certificates | Deferred, admitted additively by `{ type: "clientCert" }` and `{ type: "clientCert", certPem, keyPem }`. Token handoff, same as a long-lived key. A later `http/fetch` proxy (ADR 0009) can stop returning the key without changing the declaration. |
| SSH keys | Deferred, admitted additively by `{ type: "sshKey" }` and `{ type: "sshKey", privateKeyPem }`. |
| Service accounts | Deferred, admitted additively by `grant: "client_credentials"` on the oauth2 need (no `authorizeUrl`). The platform posts the pinned client to `tokenUrl` and returns an oauth2 access token. A service account that is only a static secret is an API key, which is now. |
| Cloud IAM roles | Deferred, admitted additively by `grant: "federation"`: `tokenUrl` on the need, the role name on install config, because the role differs per tenant. The platform exchanges the role and returns an oauth2 access token. No client secret. |
| Workload identity | Deferred, admitted additively by that same `federation` grant with no stored secret. The platform calls `tokenUrl` using the process's ambient identity. |

Also deferred, same style of optional field, and not required for HubSpot: `clientAuth: "basic"` for providers that reject `client_secret_post`, and `pkce: true` for public clients. The recipe now posts `client_id` and `client_secret` in the form body and joins scopes with a single space. That is RFC 6749, which HubSpot accepts.

Webhook verification is deferred with triggers. HubSpot signs `X-HubSpot-Signature-v3` with the client secret. The secret is already on the pin, so the platform can verify before any future `events/emit`. The app still never receives the secret. Routing by `hub_id` is a derived index from `tokenResponse`, built when triggers land. Action calls do not look up by `hub_id`. They already have an install.

### Secrets

The in-memory platform holds these in process memory. A disk later encrypts the same records. No function returns a client secret, a refresh token, or an HMAC secret after registration.

| Secret | Where it lives | Who can read it | Blast radius |
| --- | --- | --- | --- |
| Provider client id | `OAuthClient` on the app record, one per credential name. Also embedded in the authorize redirect. | The operator who submitted it, the registry when it builds the redirect, and the browser user who is sent to HubSpot. | Names the deployment's HubSpot app. Insufficient to mint a token. |
| Provider client secret | `OAuthClient.clientSecret`. Write-only after `putOAuthClient`. | The registry's token POST, and later the webhook verifier. Absent from the manifest, from `credentials/get`, from logs, and from any read API. | Every tenant grant made through this OAuth client, plus the ability to forge HubSpot webhooks for this app. |
| Refresh token | `Connection.tokenResponse` for that install and credential name. | The registry's refresh POST only. | That one tenant's HubSpot account, until HubSpot uninstall or a revoke we do not call yet. |
| Access token | Inside the same `tokenResponse`, and in the app process after `credentials/get`, until it expires (HubSpot: 30 minutes). | The registry, and the app instance handling that call. The app is expected to drop it when the call ends. | That tenant's HubSpot CRM for the remaining lifetime. |
| API key | `ApiKeyConnection.key` on the install. | The registry, and the app after `credentials/get`. | Whatever the key was granted, until the operator overwrites it or the vendor revokes it. Long-lived. |
| Tenant passwords | No Totem user password is stored. A database password is deferred with `basic`, on the install's connection record, returned by `credentials/get`. | The app, once that variant exists. | That database login. |
| Private keys | None in this slice. A deferred `clientCert` or `sshKey` private key lives on the install connection and is returned by `credentials/get`. | The app, once that variant exists. | The identity the key represents, until rotation. |
| HMAC app secret | `AppRecord.hmacSecret`, generated at `registerApp`. A copy is shown once so the operator can configure the app verifier. ADR 0008. | The platform signer and the app's signature verifier. | Forge platform-to-app calls for that app, across tenants. It does not authorize `credentials/get` and it does not read grants. |
| Callback token | Signed claims, not stored. Minted per platform-to-app call. Install hooks omit `callId`. | The app, for that call, as `Authorization: Bearer`. The platform verifier. | One install, one call, until `exp`. It cannot mint tokens or read another install. |
| Connect `state` | `PendingConnect`, single-use, 10-minute TTL. | The callback handler. | Binds one browser return to one install. Guessing it would attach an attacker's code to that install. 256-bit random. |
| Management credential | None stored now. A future API token is a hash in `access`, resolved to a `Principal`. | The authenticator. | The management actions `can` allows for that principal. It is rejected by the callback verifier (`kind` is not `"callback"`). |

### HubSpot connect flow

Management routes, each the shell for one function: `POST /apps`, `PUT /apps/:appId/credentials/:name/oauth-client`, `POST /installs`, `POST /installs/:installId/credentials/:name/connect`, `GET /oauth/callback`.

1. The operator creates a HubSpot public app and copies its client id and client secret. They register the redirect URL the platform shows: `{origin}/oauth/callback`.
2. The operator `POST /apps` with the Totem app's URL. `registerApp` checks `can`, generates the HMAC secret, returns it once, and `POST`s `initialize` to the app URL with `X-Totem-Signature`. The app returns the manifest. `acceptManifest` requires https URLs. The platform stores `AppRecord`. The app sees a normal initialize. It sees no HubSpot secret.
3. The operator `PUT`s the client id, the client secret, and the authorize URL, token URL, and scopes they were shown for the name `hubspot`. `putOAuthClient` rejects a name that is not an oauth2 need, and rejects the call when those three recipe fields differ from the stored manifest. On match it writes `OAuthClient`. Response body is empty.
4. The operator `POST /installs` for tenant `acme`. `installApp` checks `can` for that tenant, validates config (this app has none), stores `InstallRecord`, and `POST`s `install` to the app with an install-scoped callback token. The app sees `tenantId`, `installId`, and `config`. It does not see a HubSpot token. There is no connection row yet.
5. The operator clicks Connect. `startConnect` checks `can`, replaces any pending state for this install and name, and returns an authorize URL built from the pin. The shell responds 302.
6. The browser `GET`s `https://app.hubspot.com/oauth/authorize` with `client_id`, `redirect_uri` = `{origin}/oauth/callback`, `scope` = `crm.objects.contacts.read crm.objects.contacts.write`, and `state`. The operator approves on HubSpot's screen. The platform stores nothing new in this step. The app sees nothing.
7. HubSpot redirects the browser to `{origin}/oauth/callback?code&state`. `completeConnect` has no principal. It atomically consumes `PendingConnect`. A missing, expired, or replayed state stores nothing. An `error` query stores nothing.
8. The platform `POST`s `https://api.hubspot.com/oauth/v3/token` as `application/x-www-form-urlencoded`: `grant_type=authorization_code`, `code`, `redirect_uri`, `client_id`, `client_secret`. It requires `access_token`, `refresh_token`, and `expires_in`. It writes one `Connection` for `(installId, "hubspot")` with `receivedAt` and the raw JSON, which includes `hub_id`. A crash after the state is consumed and before that write burns the code. The user clicks Connect again. No half-written grant is visible, because the write is one record.
9. The app is not called from the callback. The next `credentials/get` is how it learns the install is connected. Before that, the platform returns `CredentialMissing` (`-32002`).
10. A caller invokes `upsertContact`. The platform `POST`s the app URL, HMAC-signed, with call context and a new callback token whose claims include `callId`. The app sees the action input and `ctx.credentials`.
11. The app `POST`s `platformUrl` `credentials/get` `{ "name": "hubspot" }` with `Authorization: Bearer` the callback token. The verifier accepts `kind: "callback"`, loads the install, and `issueCredential` runs. If the derived expiry is more than 60 seconds away, it returns `{ type: "oauth2", accessToken, expiresAt }`. Otherwise it refreshes, one flight per install and name, `POST`ing the pinned token URL with `grant_type=refresh_token`, `refresh_token`, `client_id`, and `client_secret`. The new JSON replaces `tokenResponse` in one write. If the provider omits `refresh_token`, the previous one is copied into that write. The app sees the access token and the expiry. It does not see `hub_id`, the refresh token, or the client secret.
12. The app `POST`s `https://api.hubapi.com/crm/v3/objects/contacts` with `Authorization: Bearer` the access token, then returns `{ contactId }`. It does not persist the token.

`putOAuthClient` and `putApiKey` overwrite. A second Connect for the same install replaces the pending state, and a successful callback replaces the connection. The previous refresh token stays valid at HubSpot until that HubSpot app is uninstalled or the token is revoked.

### Layer 1 and the existing auth surfaces

Three credentials answer three questions.

- May this operator administer this tenant? `Principal`, through `can`.
- Is this HTTP call from the platform process to this app? The HMAC secret.
- May this app read this install's grant during this call? The callback token.

Registration is allowed by `can`, and then the platform mints `hmacSecret`. The secret is not derived from the principal, and a stolen HMAC key does not pass `can`. A stolen session does not reveal the HMAC secret after the one-time display. Install is allowed by `can(principal, "installApp", tenantId)`. `createdBy` records the principal id on the row. The context the app receives is still `tenantId`, `installId`, and `config`.

Every later platform-to-app call is signed with the HMAC secret and carries a fresh callback token. `credentials/get` trusts that token and does not call `can`. The person who clicked Connect is not re-checked on the data path. The install is the scope ADR 0008 already chose, which keeps one leaked app credential inside one call.

A CI API token, when it exists, is presented to `POST /apps` and becomes a `Principal` before `registerApp`. The callback verifier rejects it. The HMAC verifier is on the app, checking platform-to-app calls, and it rejects both of those tokens because they are not the HMAC scheme. The three verifiers stay on three doors.

### Interface depth

The app author's auth surface is the recipe in the manifest plus `credentials.get(name)`. Behind that sit the pin, the state parameter, the token POST, refresh, single-flight, and the decision to keep `hub_id` in the stored JSON. The author still speaks HubSpot's CRM HTTP. That is the app's job under ADR 0006 and ADR 0009. Hiding it would mean teaching the platform the CRM.

The operator's surface is register, put client, install, start, and the browser's complete. Those are five operations because five different things become true, not because one operation was split into stages. `completeConnect` takes no principal because the callback is HubSpot's redirect and `state` is the capability. The author never calls this sequence. Doing so would be the shallow version of this design: the app would orchestrate redirect, exchange, and store, and every SDK would grow that orchestration.

No new protocol method and no new error code. Connect failures are management errors. A missing grant is the existing `CredentialMissing`.

## Synthesis decision

Arena fills this section after comparing candidates.

## Tradeoffs accepted

- We accept a pinned copy of the recipe, which the operator replaces by submitting the client secret and the new URLs again, in exchange for a fixed destination for that secret. Tenants keep refreshing through a URL change until the operator re-pins.
- We accept one OAuth client per app registration, shared by every tenant, in exchange for tenants not creating their own HubSpot developer apps.
- We accept RFC 6749 field names, `client_secret_post`, and space-separated scopes, in exchange for a recipe with no mapping options. HubSpot speaks that dialect.
- We accept access tokens in the app process for their lifetime, in exchange for the app using its own HTTP client (ADR 0009).
- We accept an orphaned refresh token at HubSpot when the operator reconnects or uninstalls, in exchange for no revoke call in this slice.
- We accept a bootstrap principal with `can` allowing that one id, in exchange for a connect flow that works before any identity provider is chosen.
- We accept process memory as the secret store, in exchange for not introducing a cipher before the platform has a disk. The record boundaries above are the part that must not move.
- We accept tightening the protocol 1 manifest so oauth2 requires the two URLs, in exchange for not bumping the major. No app in the repo declares oauth2 today. `{ type: "apiKey" }` is unchanged.
- We accept `registerApp` creating a new app id on every call, in exchange for not inventing an upsert key. Republishing an existing app is `applyManifest` after a fresh `initialize`.

## Alternatives considered

**A provider id in the manifest (`provider: "hubspot"`).** The author would write one string, which looks like a smaller surface. The platform would own a catalog of authorize URLs, token URLs, and scope lists. Every vendor the catalog lacks would wait on a platform release, including a third-party app's vendor. The complexity would sit in a module this framework cannot finish. The recipe keeps that knowledge in the app that already has to know the CRM, and the platform's public behavior stays "run authorization code."

**The app runs the OAuth dance.** The protocol would grow start, callback, and store methods, and each SDK would implement them. That is a shallow sequence: the author coordinates stages and has to learn the token endpoint to use the interface. The client secret would live in the app, or the app would fetch it, which breaks the ADR 0009 rule that the secret stays on the platform. One platform recipe hides the dance behind `credentials.get`.

**The platform proxies CRM HTTP** (rejected in ADR 0009, still rejected here). The app would stop seeing access tokens, which is stronger isolation, and would instead learn a generic HTTP port. The platform would still not know HubSpot's CRM paths unless the proxy were generic, in which case the app passes those paths anyway. The extra hop and the streaming cost remain. It can be added later against the same `needs.credentials` declaration.

## Open questions and risks

- Is the protocol 1 manifest schema frozen? This design keeps the major and requires `authorizeUrl` and `tokenUrl` on oauth2, which the published schema currently omits. Nothing shipped declares oauth2. If the schema is frozen, this is a major bump.
- Will a tenant ever bring their own HubSpot OAuth client? The pin is on the app record. Moving that record onto the install is a storage change with the same fields. It wants a yes or no before the first client is stored.
- Which issuer should mint `Principal` once the management port is reachable beyond localhost? The authenticator is the seam. The issuer is the choice.
- Should uninstall revoke the refresh token at HubSpot? The local row can be deleted either way. Revocation is a POST on the uninstall path and does not change the protocol.

## Next implementation step

Add the oauth2 `oneOf` to `protocol/manifest.schema.json` and implement `registry`'s pin, `GET /oauth/callback`, and `issueCredential` in the in-memory `platform/` package, with `sketch/hubspot-manifest.ts` as the first manifest.

## Compile

```
/home/simon/development/totem/protocol/node_modules/.bin/tsc --noEmit --strict --target es2022 --module nodenext --moduleResolution nodenext --skipLibCheck /tmp/arena-auth/candidate-3/sketch/*.ts
```

stdout:

```
```

Exit code 0.
