import {
  ErrorCode,
  PROTOCOL_VERSION,
  RpcError,
  SIGNATURE_HEADER,
  rpc,
  sign,
  type AppMethods,
  type Manifest,
} from "@totem/protocol";
import { HttpError, authorize, type Principal } from "./access.js";
import { mintCallbackToken } from "./callback-token.js";
import { Sealed, randomToken, type AppRecord, type Context, type Install } from "./store.js";

// Apps and installs: registration, manifest pull, install hooks and action invocation.

/** The path apps call platform methods on. `initialize` sends `baseUrl + PLATFORM_METHODS_PATH`. */
export const PLATFORM_METHODS_PATH = "/rpc";

/**
 * Register an app URL and issue its HMAC secret, shown once. The operator starts the app with the
 * secret, then calls `initializeApp` to pull the manifest.
 */
export function registerApp({ store }: Context, principal: Principal, url: string): { appId: string; secret: string } {
  authorize(principal, { type: "app.register" });
  const secret = randomToken();
  const app: AppRecord = {
    id: crypto.randomUUID(),
    url,
    secret: new Sealed(secret),
    manifest: null,
    oauthBindings: new Map(),
  };
  store.apps.set(app.id, app);
  return { appId: app.id, secret };
}

/** Pull the manifest through `initialize` (ADR 0007). Calling it again re-pulls. */
export async function initializeApp(ctx: Context, principal: Principal, appId: string): Promise<Manifest> {
  authorize(principal, { type: "app.register" });
  const app = getApp(ctx, appId);
  const { manifest } = await callApp(ctx, app, "initialize", {
    protocolVersion: PROTOCOL_VERSION,
    platformUrl: ctx.baseUrl + PLATFORM_METHODS_PATH,
  });
  checkEndpoints(ctx, manifest);
  app.manifest = manifest;
  return manifest;
}

/** Install an app for a tenant and run its optional `install` hook. */
export async function createInstall(
  ctx: Context,
  principal: Principal,
  tenantId: string,
  appId: string,
  config: Record<string, unknown>,
): Promise<Install> {
  authorize(principal, { type: "install.create", tenantId });
  const app = getApp(ctx, appId);
  if (!app.manifest) throw new HttpError(409, `app ${appId} has no manifest yet. Initialize it first.`);

  const install: Install = { id: crypto.randomUUID(), tenantId, appId, config, connections: new Map(), state: new Map() };
  ctx.store.installs.set(install.id, install);
  try {
    await callApp(ctx, app, "install", {
      context: { tenantId, installId: install.id, config },
      callbackToken: mintCallbackToken(ctx.store.callbackKey, install.id, null),
    });
  } catch (error) {
    if (!(error instanceof RpcError && error.code === ErrorCode.MethodNotFound)) {
      ctx.store.installs.delete(install.id);
      throw error;
    }
  }
  return install;
}

/** Run one action and return its output. App failures surface as `RpcError`. */
export async function invokeAction(
  ctx: Context,
  principal: Principal,
  installId: string,
  action: string,
  input: unknown,
): Promise<unknown> {
  const install = getInstall(ctx, installId);
  authorize(principal, { type: "install.invoke", install });
  const app = getApp(ctx, install.appId);
  const callId = crypto.randomUUID();
  const { output } = await callApp(ctx, app, "actions/invoke", {
    action,
    input,
    context: { tenantId: install.tenantId, installId: install.id, config: install.config, callId },
    callbackToken: mintCallbackToken(ctx.store.callbackKey, install.id, callId),
  });
  return output;
}

export function getApp({ store }: Context, appId: string): AppRecord {
  const app = store.apps.get(appId);
  if (!app) throw new HttpError(404, `no app ${appId}`);
  return app;
}

export function getInstall({ store }: Context, installId: string): Install {
  const install = store.installs.get(installId);
  if (!install) throw new HttpError(404, `no install ${installId}`);
  return install;
}

/** The manifest of an installed app. Installs only exist for initialized apps. */
export function manifestOf(ctx: Context, install: Install): Manifest {
  return getApp(ctx, install.appId).manifest!;
}

/** Signed JSON-RPC call to an app (ADR 0008). */
function callApp<M extends keyof AppMethods>(ctx: Context, app: AppRecord, method: M, params: AppMethods[M]["params"]) {
  return rpc<AppMethods, M>(app.url, method, params, {
    sign: async (body) => ({ [SIGNATURE_HEADER]: await sign(app.secret.reveal(), body) }),
    fetch: ctx.fetch,
  });
}

/**
 * Provider endpoints receive client secrets and refresh tokens, so check the parsed URL rather
 * than trusting the schema pattern alone (ADR 0012).
 */
function checkEndpoints({ allowLocalhost }: Context, manifest: Manifest): void {
  for (const [name, need] of Object.entries(manifest.needs.credentials ?? {})) {
    if (need.type !== "oauth2") continue;
    for (const endpoint of [need.authorizeUrl, need.tokenUrl]) {
      const url = URL.parse(endpoint);
      const ok =
        url !== null &&
        url.username === "" &&
        url.password === "" &&
        (url.protocol === "https:" || (allowLocalhost && url.protocol === "http:" && url.hostname === "localhost"));
      if (!ok) throw new HttpError(422, `credential ${name}: endpoint ${endpoint} must be https`);
    }
  }
}
