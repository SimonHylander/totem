# Protocol

The wire contract between apps and the platform. JSON Schema, draft 2020-12. Every SDK generates its bindings from these files. Nothing here depends on any SDK.

Protocol version is a single major. Breaking changes bump it. The `$id` of every schema carries the major.

## Files

| File | Contents |
|------|----------|
| [`manifest.schema.json`](manifest.schema.json) | The manifest an app returns from `initialize`. |
| [`context.schema.json`](context.schema.json) | Install and call context carried in params. |
| [`app-methods.schema.json`](app-methods.schema.json) | Methods the platform calls on an app. `$defs` per method with `params` and `result`. |
| [`platform-methods.schema.json`](platform-methods.schema.json) | Methods an app calls on the platform. Same layout. |

Manifest action and port schemas reference the draft 2020-12 meta-schema directly. Validators need format support and non-strict mode for that reference. With ajv:

```sh
npx -p ajv-cli -p ajv-formats ajv validate --spec=draft2020 --strict=false -c ajv-formats \
  -s protocol/manifest.schema.json -d manifest.json
```

Decisions behind the shape: [0007](../docs/decisions/0007-manifest.md), [0008](../docs/decisions/0008-methods-and-auth.md), [0009](../docs/decisions/0009-credentials-token-handoff.md).

## Transport

JSON-RPC 2.0 over HTTP POST. One request per HTTP call. Batch requests are not supported.

- Platform to app: `POST <appUrl>`, header `X-Totem-Signature: t=<unix seconds>,v1=<hex hmac-sha256>`. The MAC is over `<t>.<raw body>` with the app's registration secret. Reject if `t` is more than 300 seconds from now.
- App to platform: `POST <platformUrl>`, header `Authorization: Bearer <callbackToken>`.

Responses are HTTP 200 with a JSON-RPC envelope, including JSON-RPC errors. A failed signature or token check is HTTP 401 with an `Unauthorized` error envelope.

`@totem/protocol` (this folder, `src/`) exports TypeScript types for these schemas, the signing helpers and a JSON-RPC client. Both the SDK and the platform use it.

## Error codes

Protocol errors use the JSON-RPC server range `-32000` to `-32099`. Standard JSON-RPC codes (`-32600` to `-32700`) keep their meaning.

| Code | Name | When |
|------|------|------|
| `-32000` | `ProtocolVersionUnsupported` | `initialize` with a major the app does not speak. |
| `-32001` | `NotDeclared` | Driven port or connection not present in the manifest's `needs`. |
| `-32002` | `CredentialMissing` | Connection is declared but the tenant has not connected it. |
| `-32003` | `PortUnbound` | `needs.actions` port has no provider bound for this install. |
| `-32004` | `ActionNotFound` | `actions/invoke` names an action the manifest does not provide. |
| `-32005` | `Unauthorized` | Bad signature, bad or expired token. |
| `-32006` | `DeadlineExceeded` | Call ran past `context.deadline`. |

Apps report action failures with any code outside the reserved range and put details in `error.data`.
