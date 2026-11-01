# 0014: Apps can start their own actions

Status: Accepted (2026-10-25)

## Context

So far only the platform starts actions: a management API call, or a port call forwarded from another app. An app that serves its own UI needs a way in too. The events app serves a public registration page. A form submit must run `register` with the full call context: install state, config and the bound CRM port. Only the platform can supply that context.

Holding a management token in the app was rejected. It breaks [0008](0008-methods-and-auth.md): "Apps store no platform secret beyond the HMAC key."

## Decision

1. **A new app-to-platform method, `actions/start { installId, action, input }`.** It returns `{ output }`. The platform runs the action exactly as it runs an action from the management API: it calls `actions/invoke` on the app with the install's context and a fresh callback token, and the call starts at depth 0 ([0013](0013-port-binding.md)).
2. **The app signs the request with its HMAC secret.** It uses the same `X-Totem-Signature` scheme the platform uses toward the app, with no callback token. The platform loads the install, takes its app's secret, and verifies the signature. A bad signature, an unknown install, or an install of a different app all answer `Unauthorized`, so the method does not reveal whether an install exists.
3. **The app can start only its own installs and its own actions.** The app answers `ActionNotFound` for an action its manifest does not provide, as it does for the management API.
4. **The app decides who may trigger what.** The platform authenticates the app, not the person behind it. The events app exposes `register` to anyone who has an event's URL. That is a product choice of the app.

The SDK exposes this as `appClient(app, { secret, platformUrl }).start(installId, action, input)`, typed from the manifest.

## Rejected

- **A management token in the app.** It breaks 0008, and the token's authority is far wider than "run my own action".
- **The UI calling the platform directly with an end-user identity.** It needs end-user auth on the platform, which ADR [0011](0011-platform-access.md) defers.

## Consequences

- One path serves every app-initiated call: a UI form today, and an inbound webhook that the app receives itself later.
- An app's HMAC secret now authorizes calls to the platform as well as from it. A leaked secret lets an attacker run that app's actions on its installs, in addition to forging calls to the app.
- A captured `actions/start` request can be replayed while its timestamp is within the 300-second signature tolerance. Actions an app exposes this way should be safe to repeat, as the events app's `register` is per email.
- An action that starts itself through `actions/start` is not bounded by the port-call depth limit. That loop is a bug in the app.
