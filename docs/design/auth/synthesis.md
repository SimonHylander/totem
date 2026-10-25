# Auth design: synthesis

Three models designed independently from [frame.md](frame.md). Candidate 1 was Claude Opus 5.5, candidate 2 was GPT-6.1-sol and candidate 3 was Grok 4.7. A GPT-6.1-sol judge scored them against [rubric.md](rubric.md) in [judge.md](judge.md). The decisions are [0011](../../decisions/0011-platform-access.md) and [0012](../../decisions/0012-oauth-provider-details-in-manifest.md).

## Where the candidates agreed

All three run the OAuth flow in the platform. All three keep platform-level identity out of the protocol. All three leave `credentials/get` unchanged on the wire. None of them adds a provider catalog.

## Base

The base is candidate 1. The judge recommended candidate 2, and this note departs from that recommendation.

The two candidates split on one question: who writes the provider's endpoints. Candidate 2 has the operator enter them, and the manifest stays `{ type, scopes }`. Candidate 1 puts them in the manifest and has the operator pin them. That question is the one Simon asked. Candidate 2 moves the provider knowledge out of the app and into deployment setup, which every deployment then repeats.

The judge preferred candidate 2 for three reasons. Two of them were defects in candidate 1 that grafts from candidate 2 fix. The third, the protocol version change, needed an explicit policy. With those three fixed, candidate 1's manifest recipe keeps the app self-describing. Review round 2 ([review2.md](review2.md)) found two more defects in the synthesis, F12 and F13. Both are fixed below, and neither needs operator-entered endpoints.

## Grafts

| Graft | From | Fixes |
|---|---|---|
| Consent bound to the initiating browser session, with `can` rechecked in the callback | Candidate 2 | Judge F4. Without it, a consent URL sent to another tenant's admin attaches their account to the attacker's install. |
| Immutable OAuth bindings with an `id`, and each connection records its `bindingId` | Candidate 2 | Judge F5. Without it, re-pinning could send old refresh tokens to new endpoints. |
| `POST /session` sign-in with a management token, and an HttpOnly cookie | Candidate 2 | Needed by the consent binding |
| A redirect URI per binding, checked against the pending connect | Candidate 2, review round 2 F12 | Mix-up attacks. A malicious provider could relay a HubSpot code to its own token URL. |
| A refresh deletes on `invalid_grant` only if the record it read is still stored | Review round 2 F13 | A stale refresh could delete a reconnect that landed meanwhile |
| An explicit pre-release rule for protocol 1 | Judge F6 | Making `authorizeUrl` and `tokenUrl` required is a breaking schema change |
| The `jwt-bearer` grant for key-file service accounts, and full ID token validation for OIDC identity | Judge F8 and candidate 2 | The coverage table under-specified both |
| Optional quirk fields for providers like Notion (`clientAuth: "basic"`, a JSON body) | Judge F9 | R1 coverage beyond HubSpot |

## Rejected

| Idea | From | Why |
|---|---|---|
| Operator-entered endpoints | Candidate 2 | See Base |
| A bootstrap principal that allows everything on localhost | Candidate 3 | It leaves tenant isolation untested. Judge F7. |
| An audit log and an app revision system in the first slice | Candidate 2 | The HubSpot slice does not exercise them. The judge agreed (D3). |
| Cloud IAM as an OAuth bearer token | Candidate 3 | Cloud IAM needs request-signing credentials or an STS exchange. Judge F8. |

## Verification

`check-sketch.sh` compiles the [sketch](sketch/). These mutations each fail to compile, and the clean sketch passes:
- A wrong `credentials.get` narrowing.
- A manifest without `tokenUrl`.
- An http token endpoint that is not localhost.
