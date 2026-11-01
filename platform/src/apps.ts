import { AppId, InstallId, VersionId, type TenantId } from "@totem/ids";
import {
  HookSucceeded,
  Pending,
  checkBinding,
  declaresPort,
  requireActive,
  transition,
  withBinding,
  type PortBinding,
} from "@totem/installs";
import { ErrorCode, PROTOCOL_VERSION, type Manifest } from "@totem/protocol";
import { CallDepth, invoke } from "@totem/runtime";
import { requireCompatible, sameJson, type AppVersion } from "@totem/versions";
import { Clock, DateTime, Effect, Result } from "effect";
import type { Authorized } from "@totem/permissions";
import type { InstallAction } from "./access.js";
import { attributesOf, callApp } from "./adapters.js";
import { mintCallbackToken } from "./callback-token.js";
import { Conflict, InvalidManifest } from "./errors.js";
import { PlatformConfig, Sealed, Store, randomToken, type AppRecord, type Install, type Visibility } from "./store.js";

// Apps and installs: registration, manifest pull, install hooks and action invocation.

/** The path apps call platform methods on. `initialize` sends `baseUrl + PLATFORM_METHODS_PATH`. */
export const PLATFORM_METHODS_PATH = "/rpc";


/**
 * Register an app URL and issue its HMAC secret, shown once. The operator starts the app with the
 * secret, then calls `initializeApp` to pull the manifest.
 */
export const registerApp = Effect.fnUntraced(function* (_: Authorized<{ type: "app.register" }>, url: string) {
  const secret = randomToken();
  const app: AppRecord = {
    id: AppId.make(crypto.randomUUID()),
    url,
    secret: new Sealed(secret),
    latest: null,
    visibility: "internal",
    oauthBindings: new Map(),
  };
  yield* (yield* Store).apps.put(app);
  return { appId: app.id, secret };
});

/**
 * Pull the manifest through `initialize` (ADR 0007). A manifest that differs from the latest version
 * becomes a new version. Existing installs keep theirs until they upgrade (ADR 0017).
 */
export const initializeApp = Effect.fnUntraced(function* (_: Authorized<{ type: "app.register" }>, appId: AppId) {
  const { apps } = yield* Store;
  const platformUrl = (yield* PlatformConfig).baseUrl + PLATFORM_METHODS_PATH;
  const { manifest } = yield* callApp(yield* apps.get(appId), "initialize", "initialize", {}, () => ({
    protocolVersion: PROTOCOL_VERSION,
    platformUrl,
  }));
  yield* checkEndpoints(manifest);
  const version: AppVersion = { id: VersionId.make(crypto.randomUUID()), appId, manifest, pulledAt: yield* DateTime.now };
  yield* apps.update(appId, (app) => (app.latest && sameJson(app.latest.manifest, manifest) ? app : { ...app, latest: version }));
  return manifest;
});

/** Make an app public or internal (ADR 0015). New apps start internal. */
export const setVisibility = Effect.fnUntraced(function* (
  _: Authorized<{ type: "app.setVisibility" }>,
  appId: AppId,
  visibility: Visibility,
) {
  yield* (yield* Store).apps.update(appId, (app) => ({ ...app, visibility }));
});

/** Install an app for a tenant, bind its ports and run its optional `install` hook. */
export const createInstall = Effect.fnUntraced(function* (
  { action: { tenantId } }: Authorized<{ type: "install.create"; tenantId: TenantId }>,
  appId: AppId,
  config: Record<string, unknown>,
  bindings: Record<string, PortBinding>,
) {
  const store = yield* Store;
  const app = yield* store.apps.get(appId);
  if (!app.latest) return yield* new Conflict({ message: `app ${appId} has no manifest yet. Initialize it first.` });

  const unbound = newInstall(tenantId, app.latest, config);
  const checked = new Map<string, PortBinding>();
  for (const [port, binding] of Object.entries(bindings)) checked.set(port, yield* bindingFor(unbound, port, binding));
  const install: Install = { ...unbound, bindings: checked };
  yield* store.installs.put(install);
  return yield* runInstallHook(app, install);
});

/** A Pending install of `version` with no bindings, connections or state, not yet stored. */
export function newInstall(tenantId: TenantId, version: AppVersion, config: Record<string, unknown>): Install {
  return {
    id: InstallId.make(crypto.randomUUID()),
    tenantId,
    appId: version.appId,
    version,
    status: Pending.make({}),
    config,
    bindings: new Map(),
    connections: new Map(),
    state: new Map(),
  };
}

/**
 * Run the app's optional `install` hook for a stored Pending install and return it Active. A failing
 * hook removes the install again.
 */
export const runInstallHook = Effect.fnUntraced(function* (app: AppRecord, install: Install) {
  const store = yield* Store;
  const now = yield* Clock.currentTimeMillis;
  yield* callApp(app, "install", "install", attributesOf(install), (trace) => ({
    context: { tenantId: install.tenantId, installId: install.id, config: install.config },
    callbackToken: mintCallbackToken(store.callbackKey, { installId: install.id, callId: null, depth: CallDepth.make(0), trace }, now),
  })).pipe(
    Effect.catchIf(
      (error) => error.code === ErrorCode.MethodNotFound,
      () => Effect.void,
    ),
    Effect.onError(() => store.installs.remove(install.id)),
  );
  const activated = yield* store.installs.modify(install.id, (current) => {
    const next = Result.map(transition(current.status, HookSucceeded.make({})), (status): Install => ({ ...current, status }));
    return [next, Result.getOrElse(next, () => current)] as const;
  });
  return yield* Effect.fromResult(activated);
});

/** Set or replace one port binding on an existing install. */
export const setBinding = Effect.fnUntraced(function* (
  { action: { install } }: Authorized<InstallAction<"install.bind">>,
  port: string,
  binding: PortBinding,
) {
  const checked = yield* bindingFor(install, port, binding);
  yield* (yield* Store).installs.update(install.id, (current) => withBinding(current, port, checked));
});

/**
 * Move an install to its app's latest version if the change is compatible (ADR 0017). Returns the
 * version the install runs afterwards.
 */
export const upgradeInstall = Effect.fnUntraced(function* ({ action: { install } }: Authorized<InstallAction<"install.upgrade">>) {
  const { apps, installs } = yield* Store;
  const latest = (yield* apps.get(install.appId)).latest ?? install.version;
  // Compared with the stored version inside the write, so a concurrent upgrade cannot be skipped over.
  const upgraded = yield* installs.modify(install.id, (current) => {
    if (current.version.id === latest.id) return [Result.succeed(latest), current] as const;
    const compatible = Result.map(requireCompatible(current.version.manifest, latest.manifest), () => latest);
    return [compatible, Result.isSuccess(compatible) ? { ...current, version: latest } : current] as const;
  });
  return yield* Effect.fromResult(upgraded);
});

/** Run one action and return its output. App failures surface as AppFailed. */
export const invokeAction = Effect.fnUntraced(function* (
  { action: { install } }: Authorized<InstallAction<"install.invoke">>,
  action: string,
  input: unknown,
) {
  const active = yield* Effect.fromResult(requireActive(install));
  return yield* invoke(active, action, input, CallDepth.make(0));
});

/** Load the provider a binding names and run the ADR 0013 checks on it. */
const bindingFor = Effect.fnUntraced(function* (install: Install, port: string, binding: PortBinding) {
  // An undeclared port fails before a missing provider does.
  yield* Effect.fromResult(declaresPort(install.version.manifest, port));
  const provider = yield* (yield* Store).installs.get(binding.installId);
  return yield* Effect.fromResult(checkBinding(install, port, provider, binding.action));
});

/**
 * Provider endpoints receive client secrets and refresh tokens, so check the parsed URL rather
 * than trusting the schema pattern alone (ADR 0012).
 */
const checkEndpoints = Effect.fnUntraced(function* (manifest: Manifest) {
  const { allowLocalhost } = yield* PlatformConfig;
  for (const [name, need] of Object.entries(manifest.needs.credentials ?? {})) {
    if (need.type !== "oauth2") continue;
    for (const endpoint of [need.authorizeUrl, need.tokenUrl]) {
      const url = URL.parse(endpoint);
      const ok =
        url !== null &&
        url.username === "" &&
        url.password === "" &&
        (url.protocol === "https:" || (allowLocalhost && url.protocol === "http:" && url.hostname === "localhost"));
      if (!ok) return yield* new InvalidManifest({ message: `credential ${name}: endpoint ${endpoint} must be https` });
    }
  }
});
