# Rubric (picker and judge only)
Score each candidate 1-5 per criterion, with a one-line justification.
R1 Integration-agnostic platform: adding a new SaaS integration (e.g. Salesforce, Notion) needs no platform code change.
R2 Secret custody: client secrets, refresh tokens, private keys and passwords reach app code only when unavoidable. Blast radius is bounded per tenant and per install.
R3 Coverage: every connector auth type in frame.md is mapped to a mechanism, now or deferred-additive, with no redesign needed.
R4 Smallest surface for the HubSpot slice: the fewest new protocol fields, platform endpoints and SDK changes needed to ship OAuth end to end. Penalize speculative abstractions.
R5 Layer 1 correctness and minimalism: the right minimum built now, a clear deferral line for SSO, MFA, RBAC and audit, and tenant isolation enforced structurally.
R6 Fit with ADRs 0001-0010: additive, or explicitly supersedes with reason. The sketch compiles.
