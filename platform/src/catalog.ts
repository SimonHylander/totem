import { ErrorCode, RpcError, type BoundPort, type CatalogApp } from "@totem/protocol";
import { addInstall, getApp, manifestOf, newInstall } from "./apps.js";
import { credentialStatus, startOAuthConnect } from "./connections.js";
import type { Context, Install } from "./store.js";

// The catalog and port methods an app signs with its HMAC secret (ADR 0015). They let an app's own
// UI show which public apps exist and bind, unbind and connect its ports. The calling install is
// already authenticated. Every install they touch belongs to its tenant.

/** `apps/list`: every initialized public app other than the caller. */
export function listApps(ctx: Context, caller: Install): CatalogApp[] {
  return [...ctx.store.apps.values()].flatMap((app) =>
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
  );
}

/** `ports/list`: each declared port with its provider, or null when unbound. */
export function listPorts(ctx: Context, caller: Install): Record<string, BoundPort | null> {
  return Object.fromEntries(
    Object.keys(manifestOf(ctx, caller).needs.actions ?? {}).map((port) => {
      const provider = boundProvider(ctx, caller, port);
      if (!provider) return [port, null];
      const bound: BoundPort = {
        appId: provider.appId,
        name: manifestOf(ctx, provider).name,
        action: caller.bindings.get(port)!.action,
        credentials: credentialStatus(ctx, provider),
      };
      return [port, bound];
    }),
  );
}

/**
 * `ports/bind`: bind a port to an action of a public app. Uses the tenant's first install of that
 * app, or creates one with empty config.
 */
export async function bindPort(ctx: Context, caller: Install, port: string, appId: string, action: string): Promise<void> {
  declared(ctx, caller, port);
  const app = ctx.store.apps.get(appId);
  if (app?.visibility !== "public" || !app.manifest) throw new RpcError(ErrorCode.InvalidParams, `no public app ${appId}`);
  if (!(action in (app.manifest.provides.actions ?? {}))) {
    throw new RpcError(ErrorCode.ActionNotFound, `${app.manifest.name} does not provide ${action}`);
  }
  const provider =
    [...ctx.store.installs.values()].find((i) => i.tenantId === caller.tenantId && i.appId === appId) ??
    (await addInstall(ctx, app, newInstall(caller.tenantId, appId, {})));
  caller.bindings.set(port, { installId: provider.id, action });
}

/** `ports/unbind`: remove a port's binding. The provider install stays, since other ports may use it. */
export function unbindPort(ctx: Context, caller: Install, port: string): void {
  declared(ctx, caller, port);
  caller.bindings.delete(port);
}

/**
 * `ports/connect`: start an OAuth connect for the install bound to a port. `returnTo` must be on the
 * caller's registered origin, so the platform cannot be used to redirect anywhere else.
 */
export function connectPort(ctx: Context, caller: Install, port: string, credential: string, returnTo: string): string {
  declared(ctx, caller, port);
  const provider = boundProvider(ctx, caller, port);
  if (!provider) throw new RpcError(ErrorCode.PortUnbound, `port "${port}" has no provider bound`);
  if (URL.parse(returnTo)?.origin !== new URL(getApp(ctx, caller.appId).url).origin) {
    throw new RpcError(ErrorCode.InvalidParams, "returnTo must be on the app's own origin");
  }
  return startOAuthConnect(ctx, provider, credential, { sessionId: null, returnTo });
}

function declared(ctx: Context, caller: Install, port: string): void {
  if (!(port in (manifestOf(ctx, caller).needs.actions ?? {}))) {
    throw new RpcError(ErrorCode.NotDeclared, `port "${port}" is not declared in the manifest`);
  }
}

/** The provider install a port is bound to, if it still exists in the caller's tenant. */
function boundProvider(ctx: Context, caller: Install, port: string): Install | undefined {
  const binding = caller.bindings.get(port);
  const provider = binding && ctx.store.installs.get(binding.installId);
  return provider?.tenantId === caller.tenantId ? provider : undefined;
}
