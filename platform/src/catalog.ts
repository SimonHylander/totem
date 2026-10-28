import type { AppId } from "@totem/ids";
import { declaresPort, providesAction, withBinding } from "@totem/installs";
import type { AppVersion } from "@totem/versions";
import type { BoundPort, CatalogApp } from "@totem/protocol";
import { Effect } from "effect";
import { newInstall, runInstallHook } from "./apps.js";
import { credentialStatus, startOAuthConnect } from "./connections.js";
import { BadRequest, PortUnbound } from "./errors.js";
import { Store, type Install } from "./store.js";

// The catalog and port methods an app signs with its HMAC secret (ADR 0015). They let an app's own
// UI show which public apps exist and bind, unbind and connect its ports. The calling install is
// already authenticated. Every install they touch belongs to its tenant.

/** `apps/list`: every initialized public app other than the caller. */
export const listApps = (caller: Install) =>
  Store.use(({ apps }) =>
    Effect.map(apps.all, (all) =>
      all.flatMap((app): CatalogApp[] => {
        const manifest = app.latest?.manifest;
        return app.visibility === "public" && manifest && app.id !== caller.appId
          ? [
              {
                appId: app.id,
                name: manifest.name,
                ...(manifest.description !== undefined && { description: manifest.description }),
                actions: manifest.provides.actions ?? {},
              },
            ]
          : [];
      }),
    ),
  );

/** `ports/list`: each declared port with its provider, or null when unbound. */
export const listPorts = Effect.fnUntraced(function* (caller: Install) {
  const ports: Record<string, BoundPort | null> = {};
  for (const port of Object.keys(caller.version.manifest.needs.actions ?? {})) {
    const provider = yield* boundProvider(caller, port);
    ports[port] = provider
      ? {
          appId: provider.appId,
          name: provider.version.manifest.name,
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
export const bindPort = Effect.fnUntraced(function* (caller: Install, port: string, appId: AppId, action: string) {
  yield* declared(caller, port);
  const { apps, installs } = yield* Store;
  const app = yield* apps.lookup(appId);
  if (app?.visibility !== "public" || !app.latest) return yield* new BadRequest({ message: `no public app ${appId}` });
  const { latest } = app;
  const ofTenant = (install: Install) => install.tenantId === caller.tenantId && install.appId === appId;
  // An existing provider runs its pinned version, a new one the latest (ADR 0017).
  const provides = ({ manifest }: AppVersion) => Effect.fromResult(providesAction(manifest, action, manifest.name));
  yield* provides(((yield* installs.all).find(ofTenant) ?? { version: latest }).version);
  // Atomic, so concurrent binds of one tenant share a single provider install.
  const { value: provider, created } = yield* installs.findOrPut(ofTenant, () => newInstall(caller.tenantId, latest, {}));
  if (created) yield* runInstallHook(app, provider);
  else yield* provides(provider.version);
  const binding = { installId: provider.id, action };
  yield* installs.update(caller.id, (install) => withBinding(install, port, binding));
});

/** `ports/unbind`: remove a port's binding. The provider install stays, since other ports may use it. */
export const unbindPort = Effect.fnUntraced(function* (caller: Install, port: string) {
  yield* declared(caller, port);
  yield* (yield* Store).installs.update(caller.id, (install) => withBinding(install, port, undefined));
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
  yield* Effect.fromResult(declaresPort(caller.version.manifest, port));
});

/** The provider install a port is bound to, if it still exists in the caller's tenant. */
const boundProvider = Effect.fnUntraced(function* (caller: Install, port: string) {
  const binding = caller.bindings.get(port);
  const provider = binding && (yield* (yield* Store).installs.lookup(binding.installId));
  return provider?.tenantId === caller.tenantId ? provider : undefined;
});
