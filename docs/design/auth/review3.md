BLOCKERS: 0

Round-3 review. F12, F13, F14, and F15 are resolved in the design. No new blocking defect was found in the fixes.

- **F12. RESOLVED.** [ADR 0012, item 2](/home/simon/development/totem/docs/decisions/0012-oauth-provider-details-in-manifest.md:35) requires a distinct registered redirect URI per immutable binding. [redirectUriFor](/home/simon/development/totem/docs/design/auth/sketch/types.ts:330) specifies its construction. [finishOAuthConnect](/home/simon/development/totem/docs/design/auth/sketch/types.ts:418) checks the binding ID from the callback path against both the pending connect and the current binding before code exchange. In the prior mix-up scenario, the honest provider's callback path cannot match the malicious binding's pending connect. Its code is rejected before reaching that binding's token endpoint.

- **F13. RESOLVED.** [ADR 0012, item 5](/home/simon/development/totem/docs/decisions/0012-oauth-provider-details-in-manifest.md:38) applies the connection identity guard to refresh deletion as well as successful writes. [getCredential](/home/simon/development/totem/docs/design/auth/sketch/types.ts:452) specifies guarded writes, and its [invalid_grant branch](/home/simon/development/totem/docs/design/auth/sketch/types.ts:453) deletes only the record originally read. If a reconnect replaced C0 with C1, the stale failure preserves and returns C1.

- **F14. RESOLVED.** [ADR 0012, item 1](/home/simon/development/totem/docs/decisions/0012-oauth-provider-details-in-manifest.md:20) requires URL parsing at registration, actual-hostname validation, and localhost HTTP only in development mode. The [Endpoint comment](/home/simon/development/totem/docs/design/auth/sketch/types.ts:30) explicitly identifies the template's approximation and requires runtime validation. The type is no longer presented as sufficient protection against the userinfo example.

- **F15. RESOLVED.** [finishOAuthConnect](/home/simon/development/totem/docs/design/auth/sketch/types.ts:422) now stores `pending.bindingId` alongside the parsed token response. Totem's binding identity no longer comes from provider response fields.

ADR 0011 and ADR 0012 are consistent on the reviewed behavior. [0011's operator and tenant-admin authority](/home/simon/development/totem/docs/decisions/0011-platform-access.md:18) matches operator-managed bindings and tenant-admin connects in [0012](/home/simon/development/totem/docs/decisions/0012-oauth-provider-details-in-manifest.md:35). [0011's browser session](/home/simon/development/totem/docs/decisions/0011-platform-access.md:20) matches [0012's session-bound consent](/home/simon/development/totem/docs/decisions/0012-oauth-provider-details-in-manifest.md:37). The binding-specific callback path remains within [0011's OAuth route boundary](/home/simon/development/totem/docs/decisions/0011-platform-access.md:37). Apps continue to receive connector credentials without platform principals or management credentials.

Verification: `bash docs/design/auth/check-sketch.sh` passed with exit code 0 and no output. The OAuth operations remain unimplemented sketch stubs, so this result establishes type consistency. Resolution here concerns the specified behavior, not verified runtime enforcement.

Only `/tmp/arena-auth/review3.md` was written. Repository files were left untouched.
