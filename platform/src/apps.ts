import { AppId, CallId, InstallId, type TenantId } from "@totem/ids";
import {
  ErrorCode,
  PROTOCOL_VERSION,
  RpcError,
  SIGNATURE_HEADER,
  formatTrace,
  rpc,
  sign,
  type AppMethods,
  type Manifest,
  type TraceParent,
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
  PortUnbound,
} from "./errors.js";
import {
  PlatformConfig,
  Sealed,
  Store,
  randomToken,
  withEntry,
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
    id: AppId.make(crypto.randomUUID()),
    url,
    secret: new Sealed(secret),
    manifest: null,
    visibility: "internal",
    oauthBindings: new Map(),
  };
  yield* (yield* Store).apps.put(app);
  return { appId: app.id, secret };
});

/** Pull the manifest through `initialize` (ADR 0007). Calling it again re-pulls. */
export const initializeApp = Effect.fnUntraced(function* (principal: Principal, appId: AppId) {
  yield* authorize(principal, { type: "app.register" });
  const { apps } = yield* Store;
  const platformUrl = (yield* PlatformConfig).baseUrl + PLATFORM_METHODS_PATH;
  const { manifest } = yield* callApp(yield* apps.get(appId), "initialize", "initialize", {}, () => ({
    protocolVersion: PROTOCOL_VERSION,
    platformUrl,
  }));
  yield* checkEndpoints(manifest);
  yield* apps.update(appId, (app) => ({ ...app, manifest }));
  return manifest;
});

/** Make an app public or internal (ADR 0015). New apps start internal. */
export const setVisibility = Effect.fnUntraced(function* (principal: Principal, appId: AppId, visibility: Visibility) {
  yield* authorize(principal, { type: "app.setVisibility" });
  yield* (yield* Store).apps.update(appId, (app) => ({ ...app, visibility }));
});

/** Install an app for a tenant, bind its ports and run its optional `install` hook. */
export const createInstall = Effect.fnUntraced(function* (
  principal: Principal,
  tenantId: TenantId,
  appId: AppId,
  config: Record<string, unknown>,
  bindings: Record<string, PortBinding>,
) {
  yield* authorize(principal, { type: "install.create", tenantId });
  const store = yield* Store;
  const app = yield* store.apps.get(appId);
  if (!app.manifest) return yield* new Conflict({ message: `app ${appId} has no manifest yet. Initialize it first.` });

  const unbound = newInstall(tenantId, appId, config);
  const checked = new Map<string, PortBinding>();
  for (const [port, binding] of Object.entries(bindings)) checked.set(port, yield* checkBinding(unbound, port, binding));
  const install: Install = { ...unbound, bindings: checked };
  yield* store.installs.put(install);
  yield* runInstallHook(app, install);
  return install;
});

/** An install with no bindings, connections or state, not yet stored. */
export function newInstall(tenantId: TenantId, appId: AppId, config: Record<string, unknown>): Install {
  return {
    id: InstallId.make(crypto.randomUUID()),
    tenantId,
    appId,
    config,
    bindings: new Map(),
    connections: new Map(),
    state: new Map(),
  };
}

/** Run the app's optional `install` hook for a stored install. A failing hook removes the install again. */
export const runInstallHook = Effect.fnUntraced(function* (app: AppRecord, install: Install) {
  const store = yield* Store;
  const now = yield* Clock.currentTimeMillis;
  yield* callApp(app, "install", "install", attributesOf(install), (trace) => ({
    context: { tenantId: install.tenantId, installId: install.id, config: install.config },
    callbackToken: mintCallbackToken(store.callbackKey, { installId: install.id, callId: null, depth: 0, trace }, now),
  })).pipe(
    Effect.catchIf(
      (error) => error.code === ErrorCode.MethodNotFound,
      () => Effect.void,
    ),
    Effect.onError(() => store.installs.remove(install.id)),
  );
});

/** Set or replace one port binding on an existing install. */
export const setBinding = Effect.fnUntraced(function* (
  principal: Principal,
  installId: InstallId,
  port: string,
  binding: PortBinding,
) {
  const { installs } = yield* Store;
  const install = yield* installs.get(installId);
  yield* authorize(principal, { type: "install.bind", install });
  const checked = yield* checkBinding(install, port, binding);
  yield* installs.update(installId, (current) => ({ ...current, bindings: withEntry(current.bindings, port, checked) }));
});

/** Run one action and return its output. App failures surface as AppFailed. */
export const invokeAction = Effect.fnUntraced(function* (
  principal: Principal,
  installId: InstallId,
  action: string,
  input: unknown,
) {
  const install = yield* (yield* Store).installs.get(installId);
  yield* authorize(principal, { type: "install.invoke", install });
  return yield* runAction(install, action, input, 0);
});

/**
 * `actions/invoke` from an app: run the action its port is bound to, on the provider install, and
 * return the provider's output or error unchanged.
 */
export const forwardPortCall = Effect.fnUntraced(function* (claims: CallbackClaims, port: string, input: unknown) {
  const { installs } = yield* Store;
  const install = yield* installs.get(claims.installId);
  if (!(port in ((yield* manifestOf(install)).needs.actions ?? {}))) {
    return yield* new NotDeclared({ message: `port "${port}" is not declared in the manifest` });
  }
  const binding = install.bindings.get(port);
  const provider = binding && (yield* installs.lookup(binding.installId));
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
  const callId = CallId.make(crypto.randomUUID());
  const { apps, callbackKey } = yield* Store;
  const now = yield* Clock.currentTimeMillis;
  const attributes = { ...attributesOf(install), "totem.call_id": callId, "totem.action": action, "totem.depth": depth };
  const { output } = yield* callApp(yield* apps.get(install.appId), "actions/invoke", `invoke ${action}`, attributes, (trace) => ({
    action,
    input,
    context: { tenantId: install.tenantId, installId: install.id, config: install.config, callId },
    callbackToken: mintCallbackToken(callbackKey, { installId: install.id, callId, depth, trace }, now),
  }));
  return output;
});

/** A binding must name a declared port, an install of the same tenant, and an action that install provides. */
const checkBinding = Effect.fnUntraced(function* (install: Install, port: string, binding: PortBinding) {
  if (!(port in ((yield* manifestOf(install)).needs.actions ?? {}))) {
    return yield* new NotDeclared({ message: `port ${port} is not declared in the manifest` });
  }
  const provider = yield* (yield* Store).installs.get(binding.installId);
  if (provider.tenantId !== install.tenantId) {
    return yield* new Forbidden({ message: `install ${binding.installId} belongs to another tenant` });
  }
  if (!(binding.action in ((yield* manifestOf(provider)).provides.actions ?? {}))) {
    return yield* new ActionNotProvided({ message: `install ${binding.installId} does not provide ${binding.action}` });
  }
  return { installId: binding.installId, action: binding.action };
});

/** The manifest of an installed app. Installs only exist for initialized apps. */
export const manifestOf = (install: Install) =>
  Store.use(({ apps }) => Effect.map(apps.get(install.appId), (app) => app.manifest!));

const attributesOf = (install: Install) => ({
  "totem.tenant_id": install.tenantId,
  "totem.install_id": install.id,
  "totem.app_id": install.appId,
});

/**
 * Signed JSON-RPC call to an app (ADR 0008) in a client span named `name`. The span goes to the app
 * as the request's trace member, and `params` gets it to mint into the callback token, so the app's
 * callbacks land under this span (ADR 0016). A JSON-RPC error fails with AppFailed, anything else dies.
 */
function callApp<M extends keyof AppMethods>(
  app: AppRecord,
  method: M,
  name: string,
  attributes: Record<string, unknown>,
  params: (trace: TraceParent) => AppMethods[M]["params"],
) {
  return Effect.useSpan(name, { kind: "client", attributes }, (span) =>
    Effect.gen(function* () {
      const fetch = yield* FetchHttpClient.Fetch;
      const timestamp = Math.floor((yield* Clock.currentTimeMillis) / 1000);
      return yield* Effect.tryPromise({
        try: () =>
          rpc<AppMethods, M>(app.url, method, params(span), {
            // eslint-disable-next-line no-restricted-syntax -- rpc's signing callback is async
            sign: async (body) => ({ [SIGNATURE_HEADER]: await sign(app.secret.reveal(), body, timestamp) }),
            trace: formatTrace(span),
            fetch,
          }),
        catch: (error) => error,
      });
    }),
  ).pipe(
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
