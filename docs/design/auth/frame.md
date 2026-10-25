# Auth design: frame

This file is the shared input for the auth design candidates. It states the question, the grounding facts and the definition of done.

## Question

An iPaaS has two auth layers. Decide how Totem handles each one.

1. **Platform-level auth.** Who may access and administer Totem. This covers user login and SSO, MFA, roles and permissions (RBAC), tenant isolation, API tokens for managing integrations through the Totem API, audit logs and approval workflows. Example: "Can Alice install an app?" or "Can this CI pipeline register a new app version?"
2. **Connector auth.** How an app talks to the external system it integrates with. This covers OAuth 2.0 and OIDC, API keys, basic auth, mTLS client certificates, SSH keys, service accounts, cloud IAM roles and workload identity, and database usernames and passwords.

The open sub-question from Simon: should the platform know integration-specific details such as a provider's OAuth URLs, or should those be left to the app?

## Grounding (current state of the repo)

- Totem is a framework for integration platforms. Third parties write apps in any language. The platform hosts, installs and composes them, and owns tenants, credentials, permissions and versions.
- Only the protocol (`protocol/`), the TypeScript SDK (`sdk/javascript-sdk/`) and one example (`examples/contacts/`) exist. No platform server exists yet. The first platform will live in a new top-level `platform/` package with in-memory storage.
- Read these before designing: `docs/decisions/0001` to `0010`, `protocol/src/types.ts`, `protocol/README.md`, `sdk/javascript-sdk/src/types.ts`, `examples/contacts/src/manifest.ts`, `docs/open-questions.md`.
- Existing auth surfaces:
  - **Platform to app** (ADR 0008). HMAC-SHA256 signature with a per-app secret issued at registration.
  - **App to platform** (ADR 0008). Short-lived callback token minted per call, scoped to one install and one call. The platform derives the tenant from it.
  - **Connector credentials** (ADR 0009). Token handoff. The manifest declares `needs.credentials.<name> = { type: "oauth2" | "apiKey", scopes? }`. The app calls `credentials/get { name }` and gets `{ type: "oauth2", accessToken, expiresAt }` or `{ type: "apiKey", key }`. ADR 0009 says the platform owns OAuth flows, storage and refresh, and that client secrets and refresh tokens never leave the platform. Nothing says where provider URLs or client IDs come from.
- Platform-level auth does not exist at all. There are no users, operators, API tokens or roles. `tenantId` exists only as a context field.

## First consumer: the HubSpot example app

The next example is `examples/hubspot`, which provides `upsertContact` and `getContact` actions against the HubSpot CRM. Later it will add a `contactCreated` trigger fed by HubSpot webhooks. The design must make this app work end to end, including the real OAuth connect flow.

HubSpot facts, from developers.hubspot.com:
- **Developer setup.** A developer registers a HubSpot app. That registration yields a client ID and client secret. Multi-account installs require OAuth. A single account can use a static access token from a private app.
- **OAuth.** Authorize at `https://app.hubspot.com/oauth/authorize` with `client_id`, `redirect_uri` and `scope`, where scopes are space-separated. Exchange the code at `POST https://api.hubspot.com/oauth/v3/token` with a form body containing `client_id` and `client_secret`.
- **Tokens.** The access token lives 30 minutes. The refresh token lives until uninstall. Redirect URLs must be https (localhost is exempt) and must be registered in the HubSpot app config.
- **Token response.** It includes `hub_id`, the HubSpot account ID. Webhook routing will need it later.
- **Webhooks.** They are signed with `X-HubSpot-Signature-v3`, an HMAC-SHA256 over method, URI, body and timestamp, keyed with the app's client secret.

## Constraints and preferences

- Simon builds complex things as simply as possible. Use YAGNI and no speculative abstractions. Defer what the HubSpot slice does not need, but the shape must not need a redesign to admit the deferred items.
- Type safety matters. The TypeScript SDK infers handler types from the manifest literal (ADR 0010).
- The protocol is the contract (ADR 0001). Apps may be written in any language, so anything an app must implement costs N times, once per SDK.

## Definition of done

The decision is done when all of these hold:

1. An ADR in `docs/decisions/` assigns an owner and a mechanism to each of the two layers.
2. Every connector auth type listed in the question maps to a mechanism, either "now" or "deferred, admitted additively by X".
3. A TypeScript sketch of the changed protocol types compiles with `tsc --strict`, and the HubSpot manifest written against it compiles too.
4. A reviewer on a different model family than the author finds no unresolved blocking objection.
