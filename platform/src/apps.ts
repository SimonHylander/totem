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
import { mintCallbackToken, type CallbackClaims } from "./callback-token.js";
import {
  Sealed,
  randomToken,
  type AppRecord,
  type Context,
  type Install,
  type PortBinding,
  type Visibility,
} from "./store.js";

// Apps and installs: registration, manifest pull, install hooks and action invocation.

/** The path apps call platform methods on. `initialize` sends `baseUrl + PLATFORM_METHODS_PATH`. */
export const PLATFORM_METHODS_PATH = "/rpc";

/** A port call from this depth fails, so a binding cycle cannot loop (ADR 0013). */
const MAX_CALL_DEPTH = 8;

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
    visibility: "internal",
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

/** Make an app public or internal (ADR 0015). New apps start internal. */
export function setVisibility(ctx: Context, principal: Principal, appId: string, visibility: Visibility): void {
  authorize(principal, { type: "app.setVisibility" });
  getApp(ctx, appId).visibility = visibility;
}

/** Install an app for a tenant, bind its ports and run its optional `install` hook. */
export async function createInstall(
  ctx: Context,
  principal: Principal,
  tenantId: string,
  appId: string,
  config: Record<string, unknown>,
  bindings: Record<string, PortBinding> = {},
): Promise<Install> {
  authorize(principal, { type: "install.create", tenantId });
  const app = getApp(ctx, appId);
  if (!app.manifest) throw new HttpError(409, `app ${appId} has no manifest yet. Initialize it first.`);

  const install = newInstall(tenantId, appId, config);
  for (const [port, binding] of Object.entries(bindings)) install.bindings.set(port, checkBinding(ctx, install, port, binding));
  return addInstall(ctx, app, install);
}

/** An install with no bindings, connections or state, not yet stored. */
export function newInstall(tenantId: string, appId: string, config: Record<string, unknown>): Install {
  return {
    id: crypto.randomUUID(),
    tenantId,
    appId,
    config,
    bindings: new Map(),
    connections: new Map(),
    state: new Map(),
  };
}

/** Store an install and run the app's optional `install` hook. A failing hook removes it again. */
export async function addInstall(ctx: Context, app: AppRecord, install: Install): Promise<Install> {
  ctx.store.installs.set(install.id, install);
  try {
    await callApp(ctx, app, "install", {
      context: { tenantId: install.tenantId, installId: install.id, config: install.config },
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

/** Set or replace one port binding on an existing install. */
export function setBinding(ctx: Context, principal: Principal, installId: string, port: string, binding: PortBinding): void {
  const install = getInstall(ctx, installId);
  authorize(principal, { type: "install.bind", install });
  install.bindings.set(port, checkBinding(ctx, install, port, binding));
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
  return runAction(ctx, install, action, input, 0);
}

/**
 * `actions/invoke` from an app: run the action its port is bound to, on the provider install, and
 * return the provider's output or error unchanged.
 */
export async function forwardPortCall(ctx: Context, claims: CallbackClaims, port: string, input: unknown): Promise<unknown> {
  const install = getInstall(ctx, claims.installId);
  if (!(port in (manifestOf(ctx, install).needs.actions ?? {}))) {
    throw new RpcError(ErrorCode.NotDeclared, `port "${port}" is not declared in the manifest`);
  }
  const binding = install.bindings.get(port);
  const provider = binding && ctx.store.installs.get(binding.installId);
  if (!binding || provider?.tenantId !== install.tenantId) {
    throw new RpcError(ErrorCode.PortUnbound, `port "${port}" has no provider bound`);
  }
  if (claims.depth >= MAX_CALL_DEPTH) {
    throw new RpcError(ErrorCode.InvalidRequest, `port calls nested deeper than ${MAX_CALL_DEPTH}`);
  }
  return runAction(ctx, provider, binding.action, input, claims.depth + 1);
}

/**
 * Invoke an action on an install's app with a fresh call ID and callback token. `depth` counts the
 * port calls that led here (ADR 0013). The app answers ActionNotFound for actions it does not provide.
 */
export async function runAction(ctx: Context, install: Install, action: string, input: unknown, depth: number): Promise<unknown> {
  const callId = crypto.randomUUID();
  const { output } = await callApp(ctx, getApp(ctx, install.appId), "actions/invoke", {
    action,
    input,
    context: { tenantId: install.tenantId, installId: install.id, config: install.config, callId },
    callbackToken: mintCallbackToken(ctx.store.callbackKey, install.id, callId, depth),
  });
  return output;
}

/** A binding must name a declared port, an install of the same tenant, and an action that install provides. */
function checkBinding(ctx: Context, install: Install, port: string, binding: PortBinding): PortBinding {
  if (!(port in (manifestOf(ctx, install).needs.actions ?? {}))) {
    throw new HttpError(422, `port ${port} is not declared in the manifest`);
  }
  const provider = getInstall(ctx, binding.installId);
  if (provider.tenantId !== install.tenantId) throw new HttpError(403, `install ${binding.installId} belongs to another tenant`);
  if (!(binding.action in (manifestOf(ctx, provider).provides.actions ?? {}))) {
    throw new HttpError(422, `install ${binding.installId} does not provide ${binding.action}`);
  }
  return { installId: binding.installId, action: binding.action };
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
