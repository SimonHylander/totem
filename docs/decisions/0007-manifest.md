# 0007: The manifest

Status: Accepted (2026-09-26). The re-pull consequence is amended by [0017](0017-versioned-manifests.md).

## Context

The platform composes apps by reading what they provide and what they need (see [0001](0001-protocol-is-the-contract.md)). That declaration needs a shape and a way to reach the platform.

## Decision

Every app has a manifest. The platform pulls it: an operator registers the app's URL, the platform calls `initialize`, and the app returns the manifest. There is no push registration and no separate manifest file. The schema is [`protocol/manifest.schema.json`](../../protocol/manifest.schema.json).

Top level fields:

- `name`, `version` (app semver), `protocol` (protocol major the app speaks), `description`.
- `provides.actions` and `provides.triggers`. Each action has an `input` and `output` JSON Schema. Each trigger has a `payload` schema.
- `needs.credentials`. Named connections the app requires, with a type (`oauth2`, `apiKey`) and scopes. The platform owns the flow and storage.
- `needs.state`. Whether the app uses platform key-value state.
- `needs.actions`. Ports. Each port is a name with an `input` and `output` schema. The app declares a signature, not an app. The platform binds each port to a provider action at install time.
- `config`. A JSON Schema for per-install settings. The platform validates config and passes it to the app in every call context.

Everything an app may ask of the platform is declared in `needs`. A call to an undeclared port is rejected. That is the permission model.

Lifecycle methods (`install`, `uninstall`) are optional. The platform tolerates method-not-found.

## Rejected

- **Push registration.** The app would need a platform URL and a secret before any install exists.
- **Static manifest file.** Useful for a registry, not needed until publishing exists. It would be the same document.
- **Needs naming apps** (`needs.apps: ["enrich@^1"]`). Couples an app to one provider and defeats composition.

## Consequences

- Binding is by port name at install time. Schema compatibility between port and provider is not checked yet.
- Re-registering an app re-pulls the manifest. Version upgrades are a platform concern (see [open questions](../open-questions.md)).
- The permission package collapses into manifest validation and per-call checks.
