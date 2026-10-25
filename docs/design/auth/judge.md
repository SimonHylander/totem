# Auth design verdict

D1. Use candidate-2 as the base. It preserves the existing app contract and gives the HubSpot flow authenticated management access, browser-bound consent, immutable OAuth bindings, and protection against stale callbacks and refreshes. No blocking objection remains in its proposed HubSpot mechanism. These are design conclusions, not runtime verification of unimplemented functions.

D2. The platform must know the approved OAuth endpoints as configuration because it sends secrets there. candidate-2 puts that configuration under the operator's authority without adding a provider catalog or provider-specific platform code. Keep this ownership split.

D3. Reduce candidate-2's first implementation by deferring audit infrastructure and a general app-revision system. Retain the approved manifest snapshot, binding identity, browser session, tenant authorization, and connection generation checks. Those protect the current flow.

## Scores

Scores assess the submitted design, before any grafts. Each criterion has equal weight. A blocking defect cannot be offset by a higher total.

### candidate-1

| Criterion | Score | Justification |
| --- | ---: | --- |
| R1 | 3 | Manifest endpoints avoid a provider catalog, but the fixed form-body client authentication still needs engine changes for providers such as Notion. |
| R2 | 3 | Redacting secret wrappers and endpoint pins help, but existing grants are not bound to the OAuth client configuration that issued them. |
| R3 | 4 | All ten connector categories have additive mechanisms, although OIDC identity validation needs a fuller contract. |
| R4 | 4 | The OAuth flow uses the existing RPC, but required manifest endpoints and scopes expand and break the wire contract unnecessarily. |
| R5 | 3 | Scoped management tokens and stored-install authorization are sound, but consent is deliberately left unbound to the initiating browser. |
| R6 | 2 | The sketch compiles and preserves HMAC and callback roles, but it changes the protocol-1 contract without changing the major or superseding its version rule. |

Total: 19/30.

### candidate-2

| Criterion | Score | Justification |
| --- | ---: | --- |
| R1 | 3 | Operator-supplied provider data avoids vendor dispatch, but unsupported authentication and token formats still require generic engine changes. |
| R2 | 5 | Secrets stay behind typed references, grants retain immutable bindings, and deferred transports retain private keys in the platform. |
| R3 | 5 | All ten categories have specific additive mechanisms, including signed service-account assertions, cloud sessions, and brokered transports. |
| R4 | 3 | There are no new wire fields or RPCs, but audit infrastructure, revision machinery, and response-field mapping exceed the first HubSpot slice. |
| R5 | 4 | Provisioned tokens, tenant grants, and browser sessions enforce isolation now, with clear identity-provider deferrals, although audit can also wait. |
| R6 | 5 | The sketch compiles, preserves the current manifest contract, and keeps management identities separate from ADR 0008 capabilities. |

Total: 25/30.

### candidate-3

| Criterion | Score | Justification |
| --- | ---: | --- |
| R1 | 3 | Declarative recipes avoid a provider catalog, but the OAuth engine supports only the HubSpot request dialect. |
| R2 | 2 | Pins protect against manifest-only URL changes, but grants lack immutable client bindings and deferred private keys are handed to apps. |
| R3 | 2 | Every category is named, but cloud IAM credentials are incorrectly modeled as OAuth bearer tokens and OIDC validation is incomplete. |
| R4 | 4 | The callback and handoff are small, but required manifest endpoints add wire changes while essential management authentication is omitted. |
| R5 | 1 | Localhost requests receive an automatically authorized bootstrap principal, and tenant isolation is deferred to a future policy body. |
| R6 | 2 | The sketch compiles and retains the machine-auth contract, but knowingly makes breaking manifest changes under protocol major 1. |

Total: 14/30.

## Independent compile and type checks

I read every rationale and every sketch file end to end, including candidate-1's checks.ts. I also checked the grounding ADRs, current protocol schema and types, SDK types, contacts manifest, and open questions.

I independently ran each required command with TypeScript 5.9.3:

```sh
/home/simon/development/totem/protocol/node_modules/.bin/tsc --noEmit --strict --target es2022 --module nodenext --moduleResolution nodenext --skipLibCheck /tmp/arena-auth/candidate-1/sketch/*.ts
/home/simon/development/totem/protocol/node_modules/.bin/tsc --noEmit --strict --target es2022 --module nodenext --moduleResolution nodenext --skipLibCheck /tmp/arena-auth/candidate-2/sketch/*.ts
/home/simon/development/totem/protocol/node_modules/.bin/tsc --noEmit --strict --target es2022 --module nodenext --moduleResolution nodenext --skipLibCheck /tmp/arena-auth/candidate-3/sketch/*.ts
```

| Candidate | Exit code | stdout | stderr |
| --- | ---: | --- | --- |
| candidate-1 | 0 | Empty | Empty |
| candidate-2 | 0 | Empty | Empty |
| candidate-3 | 0 | Empty | Empty |

I then used the TypeScript compiler API with virtual source files held entirely in memory. No probe files were written. For example, this deliberately wrong manifest was rejected by all three with TS2322:

```ts
import type { Manifest } from "./types.js";
import { manifest } from "./hubspot-manifest.js";

({
	...manifest,
	needs: { credentials: { hubspot: { type: "wrong" } } },
}) as const satisfies Manifest;
```

| Probe | candidate-1 | candidate-2 | candidate-3 |
| --- | --- | --- | --- |
| Wrong protocol literal | Rejected | Rejected | Rejected |
| Wrong credential discriminator | Rejected | Rejected | Rejected |
| Numeric credential scopes | Rejected | Rejected | Rejected |
| Action schema with `type: "wrong"` | Rejected | Rejected | Rejected |
| Schema with numeric `required` entry | Rejected | Rejected | Rejected |
| Legacy `{ type: "oauth2", scopes: ["read"] }` need | Rejected | Accepted | Rejected |
| Legacy API-key need with `scopes` | Rejected | Accepted | Rejected |
| Undeclared credential name through proposed or current SDK | Rejected | Rejected | Rejected |
| OAuth `accessToken` without narrowing through proposed or current SDK | Accepted | Accepted | Rejected, as its usage expects |

F1. The manifest checks are substantive. None of the three Manifest types accepts arbitrary bad manifests. candidate-1's CredentialValueFor and candidate-2's Credentials correctly infer the OAuth result and reject API-key-only property access. candidate-3 retains the existing credential union and correctly requires a discriminator check.

F2. I reproduced the dependency trap separately. Importing FromSchema through the absolute protocol/node_modules symlink with skipLibCheck enabled accepted an inferred input of `{ email: 123 }`. Disabling skipLibCheck exposed unresolved ts-algebra imports. Resolving the package's real pnpm path restored `{ email: string }` and rejected that value. The submitted sketches import only JSONSchema, or use a local stand-in, so their manifest validation is not erased by this trap. For the additional SDK input/output probes, I normalized dependency imports in memory and disabled skipLibCheck. All three then rejected numeric email and contactId values with TS2322. This verifies the proposed type relationships without treating a swallowed dependency error as evidence.

F3. TypeScript unions do not enforce exact object shapes on arbitrary values. A previously declared `{ type: "apiKey", tokenUrl: "https://example.com/token" } as const` satisfies each candidate's CredentialNeed, although a fresh literal is rejected. candidate-3's claim that the union itself prevents URL fields on API keys is too strong. Runtime schema validation must enforce that boundary. Its limited JSONSchema stand-in is permitted by the task and is not itself a defect.

## Blocking defects

### F4. Browser-unbound consent in candidate-1 and candidate-3

candidate-1 explicitly accepts this risk in [rationale.md](/tmp/arena-auth/candidate-1/rationale.md:334), and [finishOAuthConnect](/tmp/arena-auth/candidate-1/sketch/types.ts:360) authenticates only state. candidate-3 does the same in [completeConnect](/tmp/arena-auth/candidate-3/sketch/types.ts:361).

A tenant attacker can start consent for their own install and send its authorization URL to another tenant's HubSpot administrator. If the victim approves, the platform stores the victim's grant on the attacker's install. Randomness, expiry, single use, and a stored startedBy do not authenticate the browser completing consent. This tenant credential disclosure blocks the proposed flow.

Bind the transaction to the initiating browser and authenticated tenant authority, and verify that binding before exchanging the code. candidate-2 already specifies this. RFC 6749 describes matching state to the user agent's authenticated state. [RFC 6749 section 10.12](https://www.rfc-editor.org/rfc/rfc6749.html#section-10.12).

### F5. OAuth client replacement can redirect old grants in candidate-1 and candidate-3

candidate-1's [Connection](/tmp/arena-auth/candidate-1/sketch/types.ts:266) has no OAuth client or binding identity. [setOAuthClient](/tmp/arena-auth/candidate-1/sketch/types.ts:326) replaces the pin, and [getCredential](/tmp/arena-auth/candidate-1/sketch/types.ts:393) refreshes through that current pin. candidate-3 has the same relationship between [putOAuthClient](/tmp/arena-auth/candidate-3/sketch/types.ts:305) and [issueCredential](/tmp/arena-auth/candidate-3/sketch/types.ts:378).

After a recipe change and re-pin, an existing refresh token can therefore be posted to the new token URL using the new client configuration. Requiring a client secret in the update is insufficient. A holder of the management credential can submit an arbitrary new secret. candidate-1's explicit claim that re-entering a secret prevents this attack is false.

Bind every grant and pending consent to an immutable approved OAuth client configuration. Changing destinations or client identity must create a new binding and require reconnect, or invalidate the old grants. A secret rotation for the same client can have an explicit separate policy. candidate-2's stored binding IDs avoid this defect.

### F6. Protocol-major violations in candidate-1 and candidate-3

Both require authorizeUrl and tokenUrl, and both stop accepting API-key scopes. candidate-1 also makes OAuth scopes required. The probes above demonstrate rejected values that the current schema accepts. Conversely, the current schema rejects their new manifest URL fields because additionalProperties is false.

[protocol/README.md](/home/simon/development/totem/protocol/README.md:5) requires a major bump for breaking changes. Both sketches still advertise protocol 1. Their rationales acknowledge some breakage but neither supersedes that versioning rule. The absence of an OAuth example does not make the changes additive, and the API-key restriction is another compatibility change. Keep the existing wire contract, bump the major and schema IDs, or explicitly replace the versioning decision with a reasoned pre-release policy.

### F7. Layer 1 is not implemented by candidate-3's bootstrap policy

[rationale.md](/tmp/arena-auth/candidate-3/rationale.md:139) attaches the same authorized principal to localhost management requests and defers both management credentials and tenant permissions. [can](/tmp/arena-auth/candidate-3/sketch/types.ts:188) accepts a nullable tenant string, so the types do not establish install ownership either.

This is an explicitly local demonstration policy. It cannot satisfy the requested platform-auth and structural tenant-isolation design. Keep its localhost limitation, but add provisioned management authentication and stored-target tenant authorization before claiming layer 1 is handled. Full login, custom RBAC, SSO, and MFA can still wait.

### F8. Incorrect deferred mechanisms in candidate-3

The [coverage table](/tmp/arena-auth/candidate-3/rationale.md:175) says cloud IAM roles return an OAuth access token. That does not cover AWS role credentials, which contain an access key ID, secret access key, and session token used for request signing. Add a distinct temporary cloud credential value, or hand off an install-scoped federation assertion for the app to exchange. [AWS AssumeRoleWithWebIdentity](https://docs.aws.amazon.com/STS/latest/APIReference/API_AssumeRoleWithWebIdentity.html).

The same table reduces OIDC to an issuer field and checking id_token.iss. Identity-token processing also needs audience, expiration, applicable nonce checks, and the required token-authenticity validation. Merely requesting an OAuth access token is a narrower capability and should be described that way. Signed-JWT service accounts also need a signing/exchange mechanism rather than being treated as static API keys. These are blockers to accepting the claimed coverage, even though those implementations are deferred. [OpenID Connect ID token validation](https://openid.net/specs/openid-connect-core-1_0.html#IDTokenValidation).

## Limits that affect the scores

F9. No candidate fully meets the strongest reading of R1 today. All fix token requests to form encoding and client_secret_post. Notion requires HTTP Basic client authentication and JSON token requests, so its OAuth connection would need generic engine extensions. This is an R1 deduction, not a blocker for the HubSpot slice. Keep those extensions platform-side and additive. [Notion authorization](https://developers.notion.com/guides/get-started/authorization#step-3-send-the-code-in-a-post-request-to-the-notion-api).

F10. The shared HubSpot facts check out. The official guide specifies the submitted token endpoint, form-body exchange, 1800-second expiry, and hub_id response field. Storing that metadata for later webhook routing is justified. [HubSpot OAuth token guide](https://developers.hubspot.com/docs/api-reference/legacy/authentication/manage-oauth-tokens).

F11. All three inherit ADR 0009's accepted residual exposure. A compromised shared app process can collect the access tokens and API keys of the installs it serves as calls arrive. A scoped callback bounds one stolen callback token. A compromised app process has broader access. That existing tradeoff is not a new blocking defect.

## Ideas to graft into candidate-2

- G1. From candidate-1, use the redacting Sealed wrapper inside the private secret backend. Typed secret references already prevent ordinary DTO exposure, but redacting actual stored values also protects accidental serialization and logs. This adds no app protocol field.
- G2. From candidate-3, retain provider-specific response metadata privately and defer its interpretation until a feature needs it. Keep standard token fields parsed and typed. For this slice, preserving hub_id is enough, so the general tokenFields mapping options and account-ID console projection can wait. Do not copy raw unvalidated token JSON as the internal token model.

The resulting base keeps candidate-2's security properties and unchanged wire contract while reducing work that HubSpot actions do not yet require. Only this verdict file was written.
