import type { BoundPort, CatalogApp } from "@totem/protocol";
import { Effect } from "effect";
import { manifestOf, newInstall, runInstallHook } from "./apps.js";
import { credentialStatus, startOAuthConnect } from "./connections.js";
import { ActionNotProvided, BadRequest, NotDeclared, PortUnbound } from "./errors.js";
import { Store, withEntry, type Install } from "./store.js";

// The catalog and port methods an app signs with its HMAC secret (ADR 0015). They let an app's own
// UI show which public apps exist and bind, unbind and connect its ports. The calling install is
// already authenticated. Every install they touch belongs to its tenant.

/** `apps/list`: every initialized public app other than the caller. */
export const listApps = (caller: Install) =>
  Store.use(({ apps }) =>
    Effect.map(apps.all, (all) =>
      all.flatMap((app): CatalogApp[] =>
      app.visibility === "public" && app.manifest && app.id !== caller.appId
        ? [
            {
              appId: app.id,
              name: app.manifest.name,
              ...(app.manifest.description !== undefined && { description: app.manifest.description }),
              actions: app.manifest.provides.actions ?? {},
            },
          ]
        : [],
      ),
    ),
  );

/** `ports/list`: each declared port with its provider, or null when unbound. */
export const listPorts = Effect.fnUntraced(function* (caller: Install) {
  const ports: Record<string, BoundPort | null> = {};
  for (const port of Object.keys((yield* manifestOf(caller)).needs.actions ?? {})) {
    const provider = yield* boundProvider(caller, port);
    ports[port] = provider
      ? {
          appId: provider.appId,
          name: (yield* manifestOf(provider)).name,
          action: caller.bindings.get(port)!.action,
          credentials: yield* credentialStatus(provider),
        }
      : null;
  }
  return ports;
});

/**
 * `ports/bind`: bind a port to an action of a public app. Uses the tenant's first install of that
 * app, or creates one with empty config.
 */
export const bindPort = Effect.fnUntraced(function* (caller: Install, port: string, appId: string, action: string) {
  yield* declared(caller, port);
  const { apps, installs } = yield* Store;
  const app = yield* apps.lookup(appId);
  if (app?.visibility !== "public" || !app.manifest) return yield* new BadRequest({ message: `no public app ${appId}` });
  if (!(action in (app.manifest.provides.actions ?? {}))) {
    return yield* new ActionNotProvided({ message: `${app.manifest.name} does not provide ${action}` });
  }
  // Atomic, so concurrent binds of one tenant share a single provider install.
  const { value: provider, created } = yield* installs.findOrPut(
    (install) => install.tenantId === caller.tenantId && install.appId === appId,
    () => newInstall(caller.tenantId, appId, {}),
  );
  if (created) yield* runInstallHook(app, provider);
  const binding = { installId: provider.id, action };
  yield* installs.update(caller.id, (install) => ({ ...install, bindings: withEntry(install.bindings, port, binding) }));
});

/** `ports/unbind`: remove a port's binding. The provider install stays, since other ports may use it. */
export const unbindPort = Effect.fnUntraced(function* (caller: Install, port: string) {
  yield* declared(caller, port);
  yield* (yield* Store).installs.update(caller.id, (install) => ({
    ...install,
    bindings: withEntry(install.bindings, port, undefined),
  }));
});

/**
 * `ports/connect`: start an OAuth connect for the install bound to a port. `returnTo` must be on the
 * caller's registered origin, so the platform cannot be used to redirect anywhere else.
 */
export const connectPort = Effect.fnUntraced(function* (caller: Install, port: string, credential: string, returnTo: string) {
  yield* declared(caller, port);
  const provider = yield* boundProvider(caller, port);
  if (!provider) return yield* new PortUnbound({ message: `port "${port}" has no provider bound` });
  if (URL.parse(returnTo)?.origin !== new URL((yield* (yield* Store).apps.get(caller.appId)).url).origin) {
    return yield* new BadRequest({ message: "returnTo must be on the app's own origin" });
  }
  return yield* startOAuthConnect(provider, credential, { sessionId: null, returnTo });
});

const declared = Effect.fnUntraced(function* (caller: Install, port: string) {
  if (!(port in ((yield* manifestOf(caller)).needs.actions ?? {}))) {
    return yield* new NotDeclared({ message: `port "${port}" is not declared in the manifest` });
  }
});

/** The provider install a port is bound to, if it still exists in the caller's tenant. */
const boundProvider = Effect.fnUntraced(function* (caller: Install, port: string) {
  const binding = caller.bindings.get(port);
  const provider = binding && (yield* (yield* Store).installs.lookup(binding.installId));
  return provider?.tenantId === caller.tenantId ? provider : undefined;
});
