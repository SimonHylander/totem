import type { AppId, TenantId } from "@totem/ids";
import { declaresPort, providesAction, requireActive, type PortBinding } from "@totem/installs";
import { ErrorCode, type BoundPort } from "@totem/protocol";
import { CallDepth, invoke } from "@totem/runtime";
import { Clock, Effect } from "effect";
import type { Authorized } from "@totem/permissions";
import type { InstallAction } from "../access/access.js";
import { attributesOf, callApp } from "../app-calls/app-calls.js";
import { CallbackKey, mintCallbackToken } from "../app-calls/callback-token.js";
import { Apps, type AppRecord } from "../apps/apps.js";
import { Connections } from "../connections/connections.js";
import { BadRequest, Conflict, PortUnbound } from "../errors.js";
import { Installs, type Install } from "./installs.js";

export const createInstall = Effect.fnUntraced(function* (
  { action: { tenantId } }: Authorized<{ type: "install.create"; tenantId: TenantId }>,
  appId: AppId,
  config: Record<string, unknown>,
  bindings: Record<string, PortBinding>,
) {
  const app = yield* (yield* Apps).get(appId);
  if (!app.latest) return yield* new Conflict({ message: `app ${appId} has no manifest yet. Initialize it first.` });
  const install = yield* (yield* Installs).create(tenantId, app.latest, config, bindings);
  return yield* runInstallHook(app, install);
});

/**
 * Run the app's optional `install` hook for a stored Pending install and return it Active. A failing
 * hook removes the install again.
 */
export const runInstallHook = Effect.fnUntraced(function* (app: AppRecord, install: Install) {
  const callbackKey = yield* CallbackKey;
  const installs = yield* Installs;
  const now = yield* Clock.currentTimeMillis;
  yield* callApp(app, "install", "install", attributesOf(install), (trace) => ({
    context: { tenantId: install.tenantId, installId: install.id, config: install.config },
    callbackToken: mintCallbackToken(callbackKey, { installId: install.id, callId: null, depth: CallDepth.make(0), trace }, now),
  })).pipe(
    Effect.catchTag("SchemaError", Effect.die),
    Effect.catchIf(
      (error) => error.code === ErrorCode.MethodNotFound,
      () => Effect.void,
    ),
    Effect.onError(() => installs.remove(install.id)),
  );
  return yield* installs.activate(install.id);
});

export const setBinding = Effect.fnUntraced(function* (
  { action: { install } }: Authorized<InstallAction<"install.bind">>,
  port: string,
  binding: PortBinding,
) {
  yield* (yield* Installs).bind(install.id, port, binding);
});

export const upgradeInstall = Effect.fnUntraced(function* ({ action: { install } }: Authorized<InstallAction<"install.upgrade">>) {
  const latest = (yield* (yield* Apps).get(install.appId)).latest ?? install.version;
  // Installs compares with the stored version inside the write, so a concurrent upgrade cannot be skipped over.
  return yield* (yield* Installs).upgrade(install.id, latest);
});

export const invokeAction = Effect.fnUntraced(function* (
  { action: { install } }: Authorized<InstallAction<"install.invoke">>,
  action: string,
  input: unknown,
) {
  const active = yield* Effect.fromResult(requireActive(install));
  return yield* invoke(active, action, input, CallDepth.make(0));
});

export const listPorts = Effect.fnUntraced(function* (caller: Install) {
  const ports: Record<string, BoundPort | null> = {};
  for (const port of Object.keys(caller.version.manifest.needs.actions ?? {})) {
    const provider = yield* boundProvider(caller, port);
    ports[port] = provider
      ? {
          appId: provider.appId,
          name: provider.version.manifest.name,
          action: caller.bindings.get(port)!.action,
          credentials: yield* (yield* Connections).status(provider),
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
  const app = yield* (yield* Apps).lookup(appId);
  if (app?.visibility !== "public" || !app.latest) return yield* new BadRequest({ message: `no public app ${appId}` });
  const installs = yield* Installs;
  // An existing provider runs its pinned version, a new one the latest (ADR 0017).
  const { install: provider, created } = yield* installs.provider(caller.tenantId, app.latest, ({ manifest }) =>
    providesAction(manifest, action, manifest.name),
  );
  if (created) yield* runInstallHook(app, provider);
  yield* installs.bind(caller.id, port, { installId: provider.id, action });
});

/** `ports/unbind`: remove a port's binding. The provider install stays, since other ports may use it. */
export const unbindPort = Effect.fnUntraced(function* (caller: Install, port: string) {
  yield* (yield* Installs).bind(caller.id, port, undefined);
});

/**
 * `ports/connect`: start an OAuth connect for the install bound to a port. `returnTo` must be on the
 * caller's registered origin, so the platform cannot be used to redirect anywhere else.
 */
export const connectPort = Effect.fnUntraced(function* (caller: Install, port: string, credential: string, returnTo: string) {
  yield* declared(caller, port);
  const provider = yield* boundProvider(caller, port);
  if (!provider) return yield* new PortUnbound({ message: `port "${port}" has no provider bound` });
  if (URL.parse(returnTo)?.origin !== new URL((yield* (yield* Apps).get(caller.appId)).url).origin) {
    return yield* new BadRequest({ message: "returnTo must be on the app's own origin" });
  }
  return yield* (yield* Connections).beginOAuthConnect(provider, credential, { sessionId: null, returnTo });
});

const declared = Effect.fnUntraced(function* (caller: Install, port: string) {
  yield* Effect.fromResult(declaresPort(caller.version.manifest, port));
});

/** The provider install a port is bound to, if it still exists in the caller's tenant. */
const boundProvider = Effect.fnUntraced(function* (caller: Install, port: string) {
  const binding = caller.bindings.get(port);
  const provider = binding && (yield* (yield* Installs).lookup(binding.installId));
  return provider?.tenantId === caller.tenantId ? provider : undefined;
});
