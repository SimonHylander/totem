# 0017: Installs pin an immutable manifest version

Status: Proposed (2026-10-28). Amends the re-pull consequence of [0007](0007-manifest.md).

## Context

[0007](0007-manifest.md) pulls one manifest per app through `initialize`. Calling `initialize` again replaces it, and every existing install follows at once. An install can lose the action a consumer's port is bound to, or gain a credential it has not connected, without anyone choosing that. The open questions list this as version negotiation, and port schema compatibility as a related gap ([0013](0013-port-binding.md)).

## Decision

1. **Each pulled manifest is an immutable version.** `initialize` stores the manifest as a new app version with its own ID, unless it equals the app's latest version. The manifest's `version` field is informational. Two pulls with the same `version` and different content are two versions.
2. **An install pins the version it was created with.** Calls, bindings, credentials and state checks read the pinned manifest. The platform refuses to invoke an action the pinned version does not provide. A new `initialize` changes only what new installs get and what `apps/list` shows.
3. **Upgrading is an explicit, per-install management call.** `POST /api/installs/:installId/upgrade` moves an install to the app's latest version. Operators and the install's tenant admin may call it.
4. **Only compatible upgrades run.** `compare(from, to)` classifies the change:
   - **Patch.** Only `name`, `version` or `description` differ.
   - **Additive.** Something was added: a provided action or trigger, or a port in `needs.actions`. Ports are optional (0013), so a new one needs nothing from the tenant.
   - **Breaking.** Something was removed or changed: a provided action or trigger, a port, a credential, `needs.state` or `config`. Any change to an action's or port's signature counts, so consumers bound to an action keep the schema they were bound against.

   The platform refuses a Breaking upgrade. The tenant installs the new version as a new install instead.

## Rejected

- **Follow the latest manifest (status quo).** Every `initialize` is an unannounced upgrade of every install.
- **Require a semver bump for new content.** Apps under development re-pull without bumping, and the platform cannot verify that the bump matches the change.
- **Upgrade every install on `initialize` when the change is compatible.** It would hide the change from tenants. An explicit call keeps the choice with the tenant and is one line to automate.
- **Schema-aware compatibility** (a widened input or narrowed output is compatible). Checking JSON Schema subsumption is hard to get right. Any signature change is Breaking until real apps show which changes are common.

## Consequences

- Re-initializing an app no longer changes existing installs. Development loops call `upgrade` after `initialize`.
- An OAuth client pins the latest version's endpoints (0012). Changed endpoints are Breaking, so an install on an older version answers that the endpoints changed, and the tenant connects through a new install.
- An app has one endpoint, which serves its newest code to every pinned version. Pinning keeps the platform's checks stable, not the app's behaviour. An app keeps serving the actions of every version an install still pins.
- Breaking changes need a new install. Migrating config, connections and state across a breaking change stays an open question.
- The install record carries its version, so a later `Upgrading` status and upgrade hook have a place to live.
