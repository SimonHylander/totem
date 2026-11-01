# 0015: Apps read the catalog and manage their own ports

Status: Accepted (2026-10-25)

## Context

The events app needs an `/integrations` page. It lists the apps a tenant could connect to the events app, and it lets the user enable and disable each one. Enabling HubSpot means three things: the tenant has a HubSpot install, the events `upsertContact` port is bound to it ([0013](0013-port-binding.md)), and HubSpot's OAuth credential is connected ([0012](0012-oauth-provider-details-in-manifest.md)).

No primitive existed for any of it. Apps could not list other apps. Only a tenant admin could create installs and bindings, through the management API, and only the platform's own pages could start an OAuth connect. A binding could be set but never removed. The platform also had no way to mark an app as available to tenants.

The events app owns its users and decides who may change its integrations. ADR [0014](0014-apps-start-their-own-actions.md) already lets an app act on its own installs, and this decision extends that.

## Decision

1. **Apps are `public` or `internal`.** An operator sets this with `PUT /api/apps/:id/visibility`. New apps start internal. Internal apps are never listed, and only an operator installs them through the management API. Visibility is a platform field, not a manifest field, because a third-party app should not decide its own listing.
2. **Five new signed methods.** Each names one of the calling app's installs and is signed with the app's HMAC secret, exactly like `actions/start`.

   | Method | Does |
   |---|---|
   | `apps/list` | Every public app other than the caller, with its `provides.actions`. |
   | `ports/list` | Each port in `needs.actions` with its provider app, action and credential status, or null. |
   | `ports/bind` | Bind a port to an action of a public app. It uses the tenant's first install of that app, or creates one with empty config. |
   | `ports/unbind` | Remove a port's binding. The provider install stays, because other ports may use it. |
   | `ports/connect` | Start an OAuth connect for the install bound to a port. It returns the provider URL, and the callback redirects to `returnTo`. |

3. **The app decides which apps fit a port.** `apps/list` returns every public app with its action schemas. The platform does not match them to ports, because port compatibility is still open. The events app treats an action with the same name as the port as a fit.
4. **App-started connects carry no platform session.** The pending connect stores `sessionId: null` and a `returnTo`. The callback skips the session check and redirects to `returnTo`. `returnTo` must have the origin of the app's registered URL, so the platform cannot redirect to any other site. Connects started on the platform's own pages keep the session check.
5. **The words "integration" and "marketplace" stay out of the protocol** ([0006](0006-integrations-are-apps.md)). The methods speak of apps and ports.

## Rejected

- **Enable and disable on platform pages.** A tenant admin would sign in to the platform and confirm each change. It keeps install authority inside the platform, but the consuming app would no longer decide who manages its integrations.
- **Platform-side port matching.** The platform would return only apps whose action name matches the port. It is simpler for apps, but it would embed a naming convention in the protocol before port compatibility is decided.
- **Visibility in the manifest.** The app's author would decide whether every tenant sees it.

## Consequences

- An app's HMAC secret now authorizes installing public apps into, and rebinding ports of, every tenant that has installed the app. A leaked secret grants that too, in addition to what ADR 0014 lists.
- The events app has no login yet. Anyone who can reach `/integrations` can change the tenant's integrations and connect any HubSpot account to it. Per-user installs and end-user auth are open questions.
- The callback cannot tell whether the browser that finishes an app-started connect is the one the app sent. A provider URL forwarded to someone else would attach their account. The provider's consent screen is the only guard, and the app should send the URL only to a user it trusts with the tenant.
- `ports/bind` creates provider installs with empty config. A provider whose config is required needs an operator or tenant admin to create its install first.
- `ports/connect` handles only oauth2 credentials. API keys are still entered through the management API.
