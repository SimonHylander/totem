# AI-native Totem: what it becomes and the next step

Status: Draft (2026-11-06). A strategy proposal, not a decision. Each build item that crosses packages gets its own ADR in [`decisions/`](../decisions/) first.

## Summary

1. **What Totem becomes.** Totem is the kernel a software company runs its app ecosystem on. Third parties ship apps in any language, tenants install and connect them, and every installed app becomes a typed, permissioned, versioned capability that people, other apps and agents can call.
2. **The category.** A multi-tenant app platform kernel. Agents are first-class callers of it, not the product. Totem is not an MCP gateway, a connector catalog, a workflow builder or an agent runtime.
3. **What "AI as a first-class citizen" means here.** Agents are principals, and MCP is an edge. The protocol gains no agent concept, just as it has no integration concept ([0006](../decisions/0006-integrations-are-apps.md)). Apps do not change. Every app that speaks the protocol becomes callable by agents with no extra work from its author.
4. **Next step.** Next week: open an agent door over the kernel that already exists. That means a read API for a tenant's installs and a tenant-scoped MCP edge, demoed on events and HubSpot. Next month: make agent writes safe and durable (action effects, approvals, a call journal, persistence), then ship triggers bound to actions. Deliberately not yet: workflows, a hosted agent runtime, skills in the protocol, UI for agents.
5. **Main risk.** Leading with "MCP" makes Totem the next Composio. The second risk is shipping agent features on a kernel that is still in memory and has no durable execution.

## 1. What Totem is becoming

The README already says "a framework for building AI native integration platforms", but no code path names an agent. The AI-native claim is currently true in one way only: [`docs/contract.md`](../contract.md) treats coding agents as a design input, so apps are easy for an agent to write correctly. `Totem.Manifest` type-checks names and keys ([`sdk/javascript-sdk/src/manifest.ts`](../../sdk/javascript-sdk/src/manifest.ts)), `fakePlatform` tests without a network, and the paved paths give one pattern to copy. The runtime side, where agents call installed apps, does not exist yet.

The product sentence, for buyers:

> Run your own app ecosystem. Partners build apps in any language, your customers install and connect them, and your product, their apps and their agents can all use those apps safely, per tenant.

Totem owns the layer between "an app exists" and "a tenant can safely use it". That layer holds tenants, credentials, installs pinned to versions, composition through ports, and audit. Everything Totem adds for agents is a view of, or a policy on, that layer.

What Totem is not:

- **Not an MCP gateway.** MCP is one door into the platform. Apps never speak it ([0003](../decisions/0003-own-protocol.md)).
- **Not a connector catalog.** The platform holds no provider code ([0012](../decisions/0012-oauth-provider-details-in-manifest.md)). Third parties own the apps.
- **Not a workflow builder.** Composition is port binding ([0013](../decisions/0013-port-binding.md)), not a canvas.
- **Not an agent runtime.** Totem does not host models or prompts. Agents run in whatever host the customer already uses, or inside an app.
- **Not personal-agent glue.** Connections belong to an install, not to a person ([0012](../decisions/0012-oauth-provider-details-in-manifest.md), consequences). Per-user credentials stay out of scope.

## 2. Where it fits

**Who buys.** A B2B SaaS company that needs integrations its own team cannot build fast enough, wants partners to build them, and has an AI assistant on its roadmap. The events app ([`examples/events/PRODUCT.md`](../../examples/events/PRODUCT.md)) is this buyer in miniature. It owns no integrations, declares an `upsertContact` port, and a tenant admin binds HubSpot to it on `/integrations`.

**Why they buy.** Otherwise they build the kernel themselves. That kernel includes tenant-scoped OAuth with pinned endpoints and mix-up defence ([0012](../decisions/0012-oauth-provider-details-in-manifest.md), model-checked in [`specs/OAuthConnect.tla`](../../specs/OAuthConnect.tla)), installs pinned to immutable versions ([0017](../decisions/0017-versioned-manifests.md)), app-to-app composition where neither app sees the other's credentials ([0013](../decisions/0013-port-binding.md)), and one trace across parties ([0016](../decisions/0016-trace-metadata.md)). The AI angle sharpens the pitch: the same kernel decides which of a tenant's apps an agent may call, and records what it did.

| Alternative | What it is | Where Totem stands |
|---|---|---|
| MCP gateways (Executor, Composio and similar) | Tools and auth for the agent a person already uses. The gateway owns the catalog. Identity is the agent host. | Totem's MCP edge makes a vendor's ecosystem reachable by those agents. Totem does not compete on catalog size or per-user auth. |
| Zapier, n8n | End-user automation builders. | No canvas. A Zapier or n8n flow is another caller of Totem's API or MCP edge. |
| Embedded iPaaS and unified APIs | Integrations built by the vendor, usually in a closed catalog. | Third parties build apps, the platform holds no provider code, and apps compose through ports. |
| Building it in-house | The default for every SaaS company with a marketplace. | This is what Totem replaces. The ADRs are a list of problems the buyer would otherwise solve alone. |
| "Just expose OpenAPI or MCP" | Your own API, made agent-readable. | That exposes the vendor's API, not its partners' apps, tenant credentials, installs or bindings. A vendor can do both, and the vendor's own product can be a Totem app. |

**On Executor v2.** Executor moved from integrations-as-specs to code-defined apps that bundle skills, UI, tools, workflows, triggers and storage, all exposed to the agent. Totem made the same move earlier in its own terms ([0006](../decisions/0006-integrations-are-apps.md)). The difference is who the app is for. An Executor app is personal software for one person's agent. A Totem app is a third-party product that many tenants install, pin and compose. Take one lesson from Executor and leave the rest: everything an app provides should reach agents without extra work from its author. Copying its feature list would turn Totem into a personal tool.

## 3. What AI as a first-class citizen means in the architecture

An agent touches Totem in one of three roles. Each role maps onto a concept that already exists, so the protocol needs no agent noun.

| Role | Maps to | State today |
|---|---|---|
| An agent writes an app | An app author | Built. Contract, typed manifests, `fakePlatform`, paved paths. |
| An agent calls installed apps from outside (Claude, ChatGPT, Cursor, the vendor's copilot) | A principal on the platform ([0011](../decisions/0011-platform-access.md)) | Missing. The management API has no read routes, no agent role and no MCP edge. |
| An agent runs inside the platform | An app whose handlers call a model and whose tools are its ports | Works in principle. A port call gives the provider its own token, so the agent never holds HubSpot's credential ([0013](../decisions/0013-port-binding.md)). Missing: triggers to wake it. |

The rule: **agents are principals or apps. MCP is an edge on the platform, never the app contract.** This is the adapter that [0003](../decisions/0003-own-protocol.md) already anticipates ("the platform can expose installed apps through an MCP adapter later"). Version pinning ([0017](../decisions/0017-versioned-manifests.md)) is what gives agents stable tool schemas. A tool's schema changes only when the tenant upgrades the install.

Each surface from the brief, decided:

| Surface | Verdict | Grounding and shape |
|---|---|---|
| Agent-callable actions | **Adopt.** Add the read side. | Invoke already exists: `POST /api/installs/:installId/actions/:action` ([`platform/src/http.ts`](../../platform/src/http.ts) line 160). Discovery does not. The management API has no `GET` route, so nothing can answer "what may I call for tenant acme?". |
| MCP edge over installed apps | **Adopt**, as a platform door next to `/api/*` and the browser pages. | `tools/list` returns the tenant's active installs with the actions of their pinned manifests. `tools/call` runs `invokeAction` ([`platform/src/apps.ts`](../../platform/src/apps.ts)). The JSON Schema that `Totem.Manifest` emits ([0019](../decisions/0019-effect-first-sdk.md)) becomes `inputSchema` and `outputSchema` as it is. Installs have no name ([`packages/installs/src/model.ts`](../../packages/installs/src/model.ts)), so a tool is named `<app>_<action>`, and a tenant with two installs of one app needs an install label. |
| Agent principal | **Adopt.** | A new `Role`, `agent`, scoped to one tenant, with an allow-list of installs and actions and a ceiling on effects. It goes behind the same `can` ([`packages/permissions/src/authorize.ts`](../../packages/permissions/src/authorize.ts)). This is L3 in 0011. For the spike, the agent uses a management token. The product needs OAuth 2.1 with Totem as the authorization server for MCP clients, which is where L1 and L4 land. |
| Agent-driven install, bind and connect | **Adapt.** | An agent may propose binding an existing install, behind approval. It may never register apps or set OAuth clients, which stay operator-only. Connect returns a URL for a person to open, because consent is bound to a browser ([0012](../decisions/0012-oauth-provider-details-in-manifest.md) item 4). |
| Approval policies | **Adopt.** | Already designed as L6 in 0011: `can` returns `allow`, `deny` or `needsApproval`, and a second principal approves a pending request. The policy reads action effects (next row). |
| Action effects metadata | **Adopt.** Land it before protocol 1 freezes. | An optional `effect: "read" \| "write" \| "destructive"` and `idempotent: boolean` on each signature in [`protocol/manifest.schema.json`](../../protocol/manifest.schema.json). A manifest is a third-party claim (0012), so effects are hints and tenant policy overrides them. An unannotated action counts as `write`. One catch: [`packages/versions/src/compare.ts`](../../packages/versions/src/compare.ts) treats any change to a signature as Breaking, including its `description`. Annotating an action, or rewriting its description so agents use it better, would force a new install. `compare` should ignore descriptions and hints. |
| Durable calls and a call journal | **Adopt** as kernel work. | `context.schema.json` defines `idempotencyKey` and `deadline`, but the platform never sets either ([`platform/src/adapters.ts`](../../platform/src/adapters.ts) line 37). Agents retry and repeat calls. A journal of every invocation (principal, install, action, input digest, outcome, trace ID) gives the audit log (L5), idempotent retries and the queue that approvals need. It needs persistent storage first, because [`platform/src/store.ts`](../../platform/src/store.ts) keeps everything in memory. |
| Event-to-agent loops | **Adopt** through triggers. | Bind a trigger to an action, the way 0013 binds a port to an action. An agent loop is then a trigger bound to an action of an agent app, with no new concept. The first real trigger is HubSpot's contact webhook, verified by the platform, because the client secret is the signing key and stays in the platform (0012). Today `Totem.Manifest` cannot declare triggers at all: it accepts `provides.actions` only ([`sdk/javascript-sdk/src/manifest.ts`](../../sdk/javascript-sdk/src/manifest.ts) line 107). |
| Durable agent workflows | **Reject for now.** | Totem makes each step durable. Workflow engines and agent hosts drive the steps. A workflow product is a different company. |
| Skills attached to apps | **Defer** the protocol field. | Action descriptions already carry usage. If a tenant's apps need more, add an optional app-level `instructions` string and serve it as the MCP server's instructions. Add a skills concept only when an app needs multi-step guidance that a description cannot hold. |
| Safe discovery | **Adopt.** | Discovery is always scoped by the principal, so a tenant sees only its own installs. Tool output from a third-party app is untrusted input to the agent, a prompt-injection path. Approval on writes is the guard. Results name the app they came from. |
| UI for agents (MCP UI resources, "transcript cards") | **Defer.** | `docs/contract.md` mentions "transcript cards" and "the framework's five public nouns", but nothing in the repo defines either. Define them or remove them before anyone builds UI for agents. |
| Streaming | **Defer** until an action needs it. | MCP progress notifications map onto the SSE plan in [0002](../decisions/0002-json-rpc-over-http.md). No current action runs long. |

## 4. The next step

**The pick:** open the agent door on the kernel that already exists, then make writes safe, then ship triggers. The first step changes no protocol and makes every existing app agent-callable. Each later step is kernel work that the platform wedge needs anyway, and agents are its first consumer.

### Next week: the agent door

1. **ADR 0020: agents are principals, MCP is an edge.** It records section 3's rule and names what stays out of the protocol.
2. **A read API.** `GET /api/tenants/:tenantId/installs`, returning app, pinned version, status, bindings and credential status (reusing `credentialStatus` in [`platform/src/connections.ts`](../../platform/src/connections.ts)), and `GET /api/installs/:installId/actions` from the pinned manifest. Operators and tenant admins need these too.
3. **An MCP edge spike.** Streamable HTTP at `/mcp`, authenticated with a tenant-admin bearer token, serving `tools/list` and `tools/call` only. Run it on the `pnpm live` demo. An agent in Claude or Cursor asked to "register ada@example.com for Totem launch" calls `events_register`. The port reaches HubSpot, the contact appears, and every hop shares one trace ID (0016).
4. **Proof.** Add an MCP step to [`examples/contacts/src/live.ts`](../../examples/contacts/src/live.ts) so that `pnpm verify:live` drives a tool call and checks the output and the trace.

Done when the demo runs and the live step is green.

### Next month: make agent writes safe, then triggers

5. **Persistent storage** behind the existing `Store` tables. Approvals, the journal and agent tokens must survive a restart.
6. **Action effects** in the manifest, with `compare` ignoring descriptions and hints. Land this while protocol 1 is still open to breaking changes. That window closes when the first external app ships (0012, "Protocol version").
7. **An agent role, approvals and a call journal** (0011 L3, L6, L5). The platform mints an idempotency key per call and deduplicates retries. Writes by agents need approval by default.
8. **Triggers.** An ADR, then `events/emit`, then subscriptions bound to actions, then trigger support in `Totem.Manifest`, then the HubSpot contact webhook. This answers the "Triggers" item in [`open-questions.md`](../open-questions.md).
9. **OAuth for MCP clients**, with Totem as the authorization server. Remote agents then connect after a tenant admin consents, with no pasted tokens.

### Deliberately not yet

- A workflow engine, canvas or cron. A `schedule` trigger source can come after triggers.
- Calling models from the platform, or hosting agents.
- Skills, or UI for agents, in the protocol.
- MCP as the protocol apps speak.
- Per-user connections, and a catalog of connectors.
- The `http/fetch` proxy ([0009](../decisions/0009-credentials-token-handoff.md)). It is the strongest isolation upgrade once agents and third-party apps meet, so build it when a buyer's security review asks, not before.

**Why this order.** [0003](../decisions/0003-own-protocol.md) rejects MCP for five reasons: triggers, tenant credentials, lifecycle, durable execution and app dependencies. Three are built. Triggers and durable execution are not. The month plan makes the whole argument true, and agents need exactly those two. The week plan proves that the kernel already exposes a better agent surface than a gateway: per-tenant, pinned, composed, and with credentials that never reach the agent.

## 5. Risks

- **Me-too blur.** Warning sign: the pitch or the homepage leads with "MCP". Guard: position on the ecosystem, and treat the MCP edge as a checkbox. The demo shows a third-party app, a tenant binding and an agent using both. It does not show an agent with 500 tools.
- **Overbuilding agent features before the kernel is sharp.** Warning sign: an agent feature that needs a new protocol noun, or one built on in-memory state. Guard: every agent feature must be a kernel feature with an agent as its first consumer. Effects feed policy, the journal is the audit log, and triggers drive the loops.
- **Underbuilding the agent surface.** Warning sign: a buyer asks in the first call whether their copilot or Claude can use installed apps, and the answer is "later". Guard: the next-week door.
- **The agent as a confused deputy.** A tenant-admin token gives an agent every install in the tenant. Manifests can lie about effects. Tool output can carry injected instructions. Token handoff lets access tokens leave the platform (0009). Guards: the scoped agent role, approval on writes by default, tenant policy over hints, and `http/fetch` when buyers ask.
- **Kernel debt that agents amplify.** The store is in memory (0011). Deadlines do not interrupt handlers (0019). Signed methods can be replayed within 300 seconds (0014). An app's HMAC secret can rebind every tenant that installed it (0015). The events `/integrations` page has no login. Agents raise the volume of calls on each of these paths.

## Appendix A: built and deferred

| Area | Built | Deferred or missing |
|---|---|---|
| Protocol | `initialize`, `health`, `install` and `uninstall`, `actions/invoke`. Callbacks: `credentials/get`, `state/get` and `state/set` with versions (0018), `log`, port calls. Signed: `actions/start`, `apps/list`, `ports/*` (0014, 0015). Trace metadata (0016). | `events/emit`, streaming, action effects |
| Platform | Tenants, two roles and one `can` with proofs (0011). Generic OAuth with pinned bindings, and API keys (0012). Port binding with a depth limit (0013). Pinned versions with compatible upgrades (0017). Tracing. | Read API, persistence, audit, approvals, idempotency and deadlines, webhooks, end-user identity |
| SDK | `Totem.Manifest` and `Totem.App` with Effect Schema emitting JSON Schema (0019). `fakePlatform`, `appClient`, `state.update`. | Triggers, Python and Go SDKs |
| Examples | HubSpot (OAuth provider), events (consumer with UI and ports), contacts (config, API key, port, live verification) | An agent consumer |
| Specs | TLA+ models of the OAuth connect flow and upgrades | Triggers, the call journal |

## Appendix B: Executor's app bag against Totem

| Executor app has | Totem today | Recommendation |
|---|---|---|
| Tools | Actions, typed and pinned | Expose them through the MCP edge |
| Storage | Install state with conditional writes (0018) | Keep. Multi-key transactions stay open. |
| Triggers | Declared in the manifest schema. No emit, no subscription, no SDK support. | Next month, bound to actions |
| Workflows | Port composition only | Do not build. Make steps durable instead. |
| UI | Owned by the app, started through `actions/start` (0014) | Keep it app-owned. Define "transcript cards" before building UI for agents. |
| Skills | Action descriptions | Optional app `instructions` first. A skills concept only on demand. |

## Appendix C: the MCP edge mapped onto Totem

| MCP | Totem source |
|---|---|
| Server, one per connection | One tenant, seen through one principal |
| `initialize` instructions | Optional app `instructions`, concatenated per install (deferred) |
| `tools/list` | The tenant's active installs and the actions of their pinned manifests, filtered by the principal's allow-list |
| Tool `inputSchema` and `outputSchema` | The signature's `input` and `output`, emitted by `Totem.Manifest` |
| Tool annotations (read-only, destructive, idempotent hints) | Action `effect` and `idempotent`, after tenant policy |
| `tools/call` | `invokeAction` at depth 0, with a journal entry and a platform-minted idempotency key |
| A call that needs consent | `needsApproval`. The tool returns a pending result that names the approval. |
| Progress notifications | The SSE streaming planned in 0002 (deferred) |
| Authorization | OAuth 2.1, with Totem as the authorization server and an `agent` principal per grant |
