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
import { Clock, Effect } from "effect";
import { FetchHttpClient } from "effect/http";
import { authorize, type Principal } from "./access.js";
import { mintCallbackToken, type CallbackClaims } from "./callback-token.js";
import {
  ActionNotProvided,
  AppFailed,
  CallDepthExceeded,
  Conflict,
  Forbidden,
  InvalidManifest,
  NotDeclared,
  NotFound,
  PortUnbound,
} from "./errors.js";
import {
  PlatformConfig,
  Sealed,
  Store,
  randomToken,
  type AppRecord,
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
export const registerApp = Effect.fnUntraced(function* (principal: Principal, url: string) {
  yield* authorize(principal, { type: "app.register" });
  const secret = randomToken();
  const app: AppRecord = {
    id: crypto.randomUUID(),
    url,
    secret: new Sealed(secret),
    manifest: null,
    visibility: "internal",
    oauthBindings: new Map(),
  };
  (yield* Store).apps.set(app.id, app);
  return { appId: app.id, secret };
});

/** Pull the manifest through `initialize` (ADR 0007). Calling it again re-pulls. */
export const initializeApp = Effect.fnUntraced(function* (principal: Principal, appId: string) {
  yield* authorize(principal, { type: "app.register" });
  const app = yield* getApp(appId);
  const { manifest } = yield* callApp(app, "initialize", {
    protocolVersion: PROTOCOL_VERSION,
    platformUrl: (yield* PlatformConfig).baseUrl + PLATFORM_METHODS_PATH,
  });
  yield* checkEndpoints(manifest);
  app.manifest = manifest;
  return manifest;
});

/** Make an app public or internal (ADR 0015). New apps start internal. */
export const setVisibility = Effect.fnUntraced(function* (principal: Principal, appId: string, visibility: Visibility) {
  yield* authorize(principal, { type: "app.setVisibility" });
  (yield* getApp(appId)).visibility = visibility;
});

/** Install an app for a tenant, bind its ports and run its optional `install` hook. */
export const createInstall = Effect.fnUntraced(function* (
  principal: Principal,
  tenantId: string,
  appId: string,
  config: Record<string, unknown>,
  bindings: Record<string, PortBinding>,
) {
  yield* authorize(principal, { type: "install.create", tenantId });
  const app = yield* getApp(appId);
  if (!app.manifest) return yield* new Conflict({ message: `app ${appId} has no manifest yet. Initialize it first.` });

  const install = newInstall(tenantId, appId, config);
  for (const [port, binding] of Object.entries(bindings)) {
    install.bindings.set(port, yield* checkBinding(install, port, binding));
  }
  return yield* addInstall(app, install);
});

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
export const addInstall = Effect.fnUntraced(function* (app: AppRecord, install: Install) {
  const store = yield* Store;
  store.installs.set(install.id, install);
  yield* callApp(app, "install", {
    context: { tenantId: install.tenantId, installId: install.id, config: install.config },
    callbackToken: mintCallbackToken(store.callbackKey, install.id, null, 0, yield* Clock.currentTimeMillis),
  }).pipe(
    Effect.catchIf(
      (error) => error.code === ErrorCode.MethodNotFound,
      () => Effect.void,
    ),
    Effect.onError(() => Effect.sync(() => store.installs.delete(install.id))),
  );
  return install;
});

/** Set or replace one port binding on an existing install. */
export const setBinding = Effect.fnUntraced(function* (
  principal: Principal,
  installId: string,
  port: string,
  binding: PortBinding,
) {
  const install = yield* getInstall(installId);
  yield* authorize(principal, { type: "install.bind", install });
  install.bindings.set(port, yield* checkBinding(install, port, binding));
});

/** Run one action and return its output. App failures surface as AppFailed. */
export const invokeAction = Effect.fnUntraced(function* (
  principal: Principal,
  installId: string,
  action: string,
  input: unknown,
) {
  const install = yield* getInstall(installId);
  yield* authorize(principal, { type: "install.invoke", install });
  return yield* runAction(install, action, input, 0);
});

/**
 * `actions/invoke` from an app: run the action its port is bound to, on the provider install, and
 * return the provider's output or error unchanged.
 */
export const forwardPortCall = Effect.fnUntraced(function* (claims: CallbackClaims, port: string, input: unknown) {
  const store = yield* Store;
  const install = yield* getInstall(claims.installId);
  if (!(port in ((yield* manifestOf(install)).needs.actions ?? {}))) {
    return yield* new NotDeclared({ message: `port "${port}" is not declared in the manifest` });
  }
  const binding = install.bindings.get(port);
  const provider = binding && store.installs.get(binding.installId);
  if (!binding || provider?.tenantId !== install.tenantId) {
    return yield* new PortUnbound({ message: `port "${port}" has no provider bound` });
  }
  if (claims.depth >= MAX_CALL_DEPTH) {
    return yield* new CallDepthExceeded({ message: `port calls nested deeper than ${MAX_CALL_DEPTH}` });
  }
  return yield* runAction(provider, binding.action, input, claims.depth + 1);
});

/**
 * Invoke an action on an install's app with a fresh call ID and callback token. `depth` counts the
 * port calls that led here (ADR 0013). The app answers ActionNotFound for actions it does not provide.
 */
export const runAction = Effect.fnUntraced(function* (install: Install, action: string, input: unknown, depth: number) {
  const callId = crypto.randomUUID();
  const { callbackKey } = yield* Store;
  const { output } = yield* callApp(yield* getApp(install.appId), "actions/invoke", {
    action,
    input,
    context: { tenantId: install.tenantId, installId: install.id, config: install.config, callId },
    callbackToken: mintCallbackToken(callbackKey, install.id, callId, depth, yield* Clock.currentTimeMillis),
  });
  return output;
});

/** A binding must name a declared port, an install of the same tenant, and an action that install provides. */
const checkBinding = Effect.fnUntraced(function* (install: Install, port: string, binding: PortBinding) {
  if (!(port in ((yield* manifestOf(install)).needs.actions ?? {}))) {
    return yield* new NotDeclared({ message: `port ${port} is not declared in the manifest` });
  }
  const provider = yield* getInstall(binding.installId);
  if (provider.tenantId !== install.tenantId) {
    return yield* new Forbidden({ message: `install ${binding.installId} belongs to another tenant` });
  }
  if (!(binding.action in ((yield* manifestOf(provider)).provides.actions ?? {}))) {
    return yield* new ActionNotProvided({ message: `install ${binding.installId} does not provide ${binding.action}` });
  }
  return { installId: binding.installId, action: binding.action };
});

export const getApp = Effect.fnUntraced(function* (appId: string) {
  const app = (yield* Store).apps.get(appId);
  if (!app) return yield* new NotFound({ message: `no app ${appId}` });
  return app;
});

export const getInstall = Effect.fnUntraced(function* (installId: string) {
  const install = (yield* Store).installs.get(installId);
  if (!install) return yield* new NotFound({ message: `no install ${installId}` });
  return install;
});

/** The manifest of an installed app. Installs only exist for initialized apps. */
export const manifestOf = (install: Install) => Effect.map(getApp(install.appId), (app) => app.manifest!);

/** Signed JSON-RPC call to an app (ADR 0008). A JSON-RPC error fails with AppFailed, anything else dies. */
function callApp<M extends keyof AppMethods>(app: AppRecord, method: M, params: AppMethods[M]["params"]) {
  return Effect.gen(function* () {
    const fetch = yield* FetchHttpClient.Fetch;
    const timestamp = Math.floor((yield* Clock.currentTimeMillis) / 1000);
    return yield* Effect.tryPromise({
      try: () =>
        rpc<AppMethods, M>(app.url, method, params, {
          sign: async (body) => ({ [SIGNATURE_HEADER]: await sign(app.secret.reveal(), body, timestamp) }),
          fetch,
        }),
      catch: (error) => error,
    });
  }).pipe(
    Effect.catch((error) =>
      error instanceof RpcError
        ? Effect.fail(new AppFailed({ code: error.code, message: error.message, data: error.data }))
        : Effect.die(error),
    ),
  );
}

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
