# Auth design round-2 review

BLOCKERS: 2. F4–F8 are resolved. New findings F12 and F13 block approval.

## Round-1 blockers

- **F4. RESOLVED.** [ADR 0012:37](/home/simon/development/totem/docs/decisions/0012-oauth-provider-details-in-manifest.md:37) requires the initiating browser session and a fresh authorization check before code exchange. [PendingConnect.sessionId](/home/simon/development/totem/docs/design/auth/sketch/types.ts:319) stores that identity. [finishOAuthConnect:400](/home/simon/development/totem/docs/design/auth/sketch/types.ts:400) compares it and checks the stored install's tenant authority before exchanging the code. Sending the original authorization URL to another browser no longer suffices.

- **F5. RESOLVED.** [ADR 0012:35](/home/simon/development/totem/docs/decisions/0012-oauth-provider-details-in-manifest.md:35) and [ADR 0012:36](/home/simon/development/totem/docs/decisions/0012-oauth-provider-details-in-manifest.md:36) assign immutable binding identities and invalidate connections when client identity or endpoints change. The sketch records [Connection.bindingId](/home/simon/development/totem/docs/design/auth/sketch/types.ts:291) and [PendingConnect.bindingId](/home/simon/development/totem/docs/design/auth/sketch/types.ts:317), checks pending bindings at [types.ts:402](/home/simon/development/totem/docs/design/auth/sketch/types.ts:402), and checks connection bindings at [types.ts:428](/home/simon/development/totem/docs/design/auth/sketch/types.ts:428). Refresh uses the connection's binding at [types.ts:432](/home/simon/development/totem/docs/design/auth/sketch/types.ts:432). Re-pinning does not redirect an old refresh token to the replacement endpoint.

- **F6. RESOLVED.** [ADR 0012:68](/home/simon/development/totem/docs/decisions/0012-oauth-provider-details-in-manifest.md:68) explicitly acknowledges every breaking manifest change and replaces the [README's major-version rule](/home/simon/development/totem/protocol/README.md:5) until the first external app ships. Round 1 explicitly allowed a reasoned pre-release policy. The sketch's protocol `1` is consistent with that proposed exception. This review does not treat the change as backward compatible.

- **F7. RESOLVED.** [ADR 0011:17](/home/simon/development/totem/docs/decisions/0011-platform-access.md:17) specifies provisioned management-token authentication. [ADR 0011:18](/home/simon/development/totem/docs/decisions/0011-platform-access.md:18) defines operator and tenant-admin authority. [ADR 0011:19](/home/simon/development/totem/docs/decisions/0011-platform-access.md:19) requires authorization inside management functions against stored installs. These appear in [Role](/home/simon/development/totem/docs/design/auth/sketch/types.ts:186), [ManagementAction](/home/simon/development/totem/docs/design/auth/sketch/types.ts:195), and [can](/home/simon/development/totem/docs/design/auth/sketch/types.ts:226). Callback credentials remain separate under [ADR 0011:41](/home/simon/development/totem/docs/decisions/0011-platform-access.md:41).

- **F8. RESOLVED.** [ADR 0012:48](/home/simon/development/totem/docs/decisions/0012-oauth-provider-details-in-manifest.md:48) limits current OIDC coverage to API access and requires full ID-token validation when identity support arrives. [ADR 0012:53](/home/simon/development/totem/docs/decisions/0012-oauth-provider-details-in-manifest.md:53) names platform-signed JWT assertions for key-file service accounts. [ADR 0012:54](/home/simon/development/totem/docs/decisions/0012-oauth-provider-details-in-manifest.md:54) uses an install-scoped federation token exchanged at cloud STS. It no longer misrepresents AWS signing credentials as an OAuth access token. These mechanisms agree with [OIDC Core](https://openid.net/specs/openid-connect-core-1_0.html#IDTokenValidation), [RFC 7523](https://www.rfc-editor.org/rfc/rfc7523.html#section-2.1), and [AWS STS](https://docs.aws.amazon.com/STS/latest/APIReference/API_AssumeRoleWithWebIdentity.html).

## New blocking defects

### F12. A shared callback permits OAuth provider mix-up

All providers share [one redirect URI](/home/simon/development/totem/docs/design/auth/sketch/types.ts:328). [CallbackQuery](/home/simon/development/totem/docs/design/auth/sketch/types.ts:324) has no issuer, and [finishOAuthConnect](/home/simon/development/totem/docs/design/auth/sketch/types.ts:399) checks only state, session, install authority, and binding before exchange.

Assume one registered provider is malicious or compromised. The victim starts its connect. That provider redirects to HubSpot using Totem's public HubSpot client ID and shared redirect URI, retaining the victim's state. After consent, Totem sends the HubSpot code to the malicious provider's pinned token endpoint. The attacker then starts a HubSpot connect on their own install and submits the captured code with their own state and session. All specified checks pass, and Totem redeems the victim's code into the attacker's install.

This inferred attack follows [RFC 9700 sections 4.4 and 4.5](https://www.rfc-editor.org/rfc/rfc9700.html#section-4.4). Browser binding does not authenticate the code's issuer.

Use distinct registered redirect URIs per binding or issuer and verify the callback route against the pending binding. Alternatively, validate a pinned issuer in the authorization response. Candidate-2 already used binding-specific callbacks.

### F13. A stale refresh failure can delete a successful reconnect

[types.ts:434](/home/simon/development/totem/docs/design/auth/sketch/types.ts:434) guards successful refresh writes with connection-record identity. The next line, [types.ts:435](/home/simon/development/totem/docs/design/auth/sketch/types.ts:435), specifies deletion on `invalid_grant` without the same condition.

An old connection C0 starts refreshing. While that request is in flight, a successful reconnect stores C1 through [finishOAuthConnect:405](/home/simon/development/totem/docs/design/auth/sketch/types.ts:405). The old refresh then returns `invalid_grant`. Following the specified error branch deletes C1, losing the newly connected credential and forcing another consent flow. Single-flight refresh does not prevent this because it is keyed to C0, while reconnect creates another record.

Apply the identity check to every refresh mutation, including deletion. Delete only if the stored connection is still C0. If another operation replaced it, reread the current connection. This is necessary in the first, single-process platform, independently of the later multi-process compare-and-set work in [ADR 0012:82](/home/simon/development/totem/docs/decisions/0012-oauth-provider-details-in-manifest.md:82).

## Non-blocking notes

- **F14. Validate endpoints at runtime.** [Endpoint](/home/simon/development/totem/docs/design/auth/sketch/types.ts:30) is an approximate string type. For example, `http://localhost:80@evil.example/token` fits its localhost template but names an external HTTP host. The implementation must parse the URL, check its actual hostname, and enforce the development-mode restriction required by [ADR 0012:20](/home/simon/development/totem/docs/decisions/0012-oauth-provider-details-in-manifest.md:20). The ADR's rule is sound. The type alone does not enforce it.

- **F15. Store the pending binding identity.** [types.ts:405](/home/simon/development/totem/docs/design/auth/sketch/types.ts:405) says to obtain `bindingId` from the response. HubSpot does not return Totem's internal binding ID. Use the verified `pending.bindingId` and parse the provider token fields separately. This appears to be shorthand rather than a different intended ownership model. [HubSpot's token response](https://developers.hubspot.com/docs/api-reference/legacy/authentication/manage-oauth-tokens) documents the provider fields.

## Rationale for changing the base

**No, as written.** Keeping provider endpoints in the app's manifest reduces repeated deployment setup, and operator approval plus immutable bindings is a reasonable way to protect secret destinations. The explicit pre-release policy also answers the original version objection. However, [the synthesis's claim of equivalent security](/home/simon/development/totem/docs/design/auth/synthesis.md:15) is premature. It omits candidate-2's binding-specific callback verification and does not carry the refresh identity guard through the error path. Fixing F12 and F13 can preserve the manifest ownership choice. Neither fix requires operator-entered endpoints, a provider catalog, or the deferred audit and revision systems.

## Verification and limits

`docs/design/auth/check-sketch.sh` passed with exit code 0 and no output. I read the frame, synthesis, both proposed ADRs, all sketch files, ADRs 0001–0010, and `protocol/README.md`, plus the current protocol and SDK types and contacts manifest.

I also replayed the specified callback checks and refresh-deletion ordering in memory. The replay admitted the cross-tenant code injection and deleted the replacement connection. Those are transition models of the design, not tests of a running platform. The platform functions remain unimplemented sketch stubs, so compilation establishes type consistency only.

Only `/tmp/arena-auth/review2.md` was written. The repository's existing worktree changes were left untouched.
