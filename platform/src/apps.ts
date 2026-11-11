import { AppId, VersionId, type TenantId } from "@totem/ids";
import { requireActive, type PortBinding } from "@totem/installs";
import { ErrorCode, PROTOCOL_VERSION, type Manifest } from "@totem/protocol";
import { CallDepth, invoke } from "@totem/runtime";
import { sameJson, type AppVersion } from "@totem/versions";
import { Clock, Context, DateTime, Effect, Layer } from "effect";
import type { Authorized } from "@totem/permissions";
import type { InstallAction } from "./access.js";
import { attributesOf, callApp } from "./app-calls.js";
import { CallbackKey, mintCallbackToken } from "./callback-token.js";
import { Conflict, InvalidManifest } from "./errors.js";
import { Installs, type Install } from "./installs.js";
import { PLATFORM_METHODS_PATH } from "./paths.js";
import { PlatformConfig } from "./config.js";
import { Sealed, randomToken } from "./secrets.js";
import { makeTable, type Table } from "./table.js";

// Apps and installs: registration, manifest pull, install hooks and action invocation.

export type Visibility = "public" | "internal";

export type AppRecord = {
  readonly id: AppId;
  readonly url: string;
  /** ADR 0008 platform-to-app signing key, issued at registration. */
  readonly secret: Sealed;
  /** The version new installs get. Null until `initialize` has pulled a manifest (ADR 0017). */
  readonly latest: AppVersion | null;
  /** Set by an operator. `apps/list` shows only public apps, and `ports/bind` binds only to them (ADR 0015). */
  readonly visibility: Visibility;
};

/** Registered apps by ID. */
export class Apps extends Context.Service<Apps, Table<AppId, AppRecord>>()("@totem/platform/Apps") {
  static readonly layer = Layer.effect(Apps, makeTable("app", (app: AppRecord) => app.id));
}


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
  };
  yield* (yield* Apps).put(app);
  return { appId: app.id, secret };
});

/**
 * Pull the manifest through `initialize` (ADR 0007). A manifest that differs from the latest version
 * becomes a new version. Existing installs keep theirs until they upgrade (ADR 0017).
 */
export const initializeApp = Effect.fnUntraced(function* (_: Authorized<{ type: "app.register" }>, appId: AppId) {
  const apps = yield* Apps;
  const platformUrl = (yield* PlatformConfig).baseUrl + PLATFORM_METHODS_PATH;
  const { manifest } = yield* callApp(yield* apps.get(appId), "initialize", "initialize", {}, () => ({
    protocolVersion: PROTOCOL_VERSION,
    platformUrl,
  })).pipe(Effect.catchTag("SchemaError", (error) => Effect.fail(new InvalidManifest({ message: error.message }))));
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
  yield* (yield* Apps).update(appId, (app) => ({ ...app, visibility }));
});

/** Install an app for a tenant, bind its ports and run its optional `install` hook. */
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

/** Set or replace one port binding on an existing install. */
export const setBinding = Effect.fnUntraced(function* (
  { action: { install } }: Authorized<InstallAction<"install.bind">>,
  port: string,
  binding: PortBinding,
) {
  yield* (yield* Installs).bind(install.id, port, binding);
});

/**
 * Move an install to its app's latest version if the change is compatible (ADR 0017). Returns the
 * version the install runs afterwards.
 */
export const upgradeInstall = Effect.fnUntraced(function* ({ action: { install } }: Authorized<InstallAction<"install.upgrade">>) {
  const latest = (yield* (yield* Apps).get(install.appId)).latest ?? install.version;
  // Installs compares with the stored version inside the write, so a concurrent upgrade cannot be skipped over.
  return yield* (yield* Installs).upgrade(install.id, latest);
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
