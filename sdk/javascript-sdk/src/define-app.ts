import type { CallContext, InstallContext, LogLevel, Manifest, TraceMetadata, TraceParent } from "@totem/protocol";
import { runCall, type Observability } from "./observability.js";
import type { Platform } from "./platform.js";
import type { ActionInput, ActionName, ActionOutput, CallCtx, Handlers, InstallCtx, Ports } from "./types.js";

type InvokeOptions = {
  platform: Platform;
  context?: Partial<CallContext>;
  observability?: Observability;
};

type LifecycleOptions = {
  platform: Platform;
  context?: Partial<InstallContext>;
  observability?: Observability;
};

/**
 * What `createHandler` adds to a call: the span the platform sent, and a Platform that names the
 * call's own span on every callback. Direct invocation in tests has neither.
 */
export type Remote = { parent: TraceParent | undefined; connect: (trace: TraceMetadata) => Platform };

/** A call reaches the platform through a given Platform, or through `createHandler`'s Remote. */
type Source = { platform: Platform; remote?: undefined } | { platform?: undefined; remote: Remote };

function remoteOf(source: Source): Remote {
  if (source.remote) return source.remote;
  const { platform } = source;
  return { parent: undefined, connect: () => platform };
}

type Log = (level: LogLevel, message: string, data?: Record<string, unknown>) => Promise<void>;

export type App<M extends Manifest> = {
  manifest: M;
  handlers: Handlers<M>;
  /** Run an action against any `Platform`. Tests pass a `fakePlatform`. */
  invoke<K extends ActionName<M>>(action: K, input: ActionInput<M, K>, options: InvokeOptions): Promise<ActionOutput<M, K>>;
  install(options: LifecycleOptions): Promise<void>;
  uninstall(options: LifecycleOptions): Promise<void>;
};

/**
 * `App` with the manifest-derived types erased. The handler and the platform
 * dispatch by string and never need the inferred shapes, which are expensive
 * to instantiate generically.
 */
export type AnyApp = {
  manifest: Manifest;
  handlers: {
    actions: Record<string, (input: unknown, ctx: CallCtx<Manifest>) => Promise<unknown>>;
    install?: (ctx: InstallCtx<Manifest>) => Promise<void>;
    uninstall?: (ctx: InstallCtx<Manifest>) => Promise<void>;
  };
  invoke(action: string, input: unknown, options: Omit<InvokeOptions, "platform"> & Source): Promise<unknown>;
  install(options: Omit<LifecycleOptions, "platform"> & Source): Promise<void>;
  uninstall(options: Omit<LifecycleOptions, "platform"> & Source): Promise<void>;
};

const defaultContext: InstallContext = { tenantId: "test-tenant", installId: "test-install", config: {} };

function installCtx(manifest: Manifest, platform: Platform, log: Log, context: InstallContext): InstallCtx<Manifest> {
  const at = (level: LogLevel) => (message: string, data?: Record<string, unknown>) => log(level, message, data);
  return {
    tenantId: context.tenantId,
    installId: context.installId,
    config: context.config,
    credentials: { get: (name) => platform.getCredential(name) },
    log: { debug: at("debug"), info: at("info"), warn: at("warn"), error: at("error") },
    ...(manifest.needs.state && {
      state: {
        get: (key: string) => platform.getState(key),
        set: (key: string, value: unknown) => platform.setState(key, value),
      },
    }),
  };
}

function callCtx(manifest: Manifest, platform: Platform, log: Log, context: CallContext): CallCtx<Manifest> {
  const ports: Ports<Manifest> = Object.fromEntries(
    Object.keys(manifest.needs.actions ?? {}).map((port) => [port, (input: unknown) => platform.invokePort(port, input)]),
  );
  return {
    ...installCtx(manifest, platform, log, context),
    callId: context.callId,
    ...(context.idempotencyKey !== undefined && { idempotencyKey: context.idempotencyKey }),
    ...(context.deadline !== undefined && { deadline: new Date(context.deadline) }),
    ports,
  };
}

/**
 * Bind handlers to a manifest. Handler signatures are inferred from the
 * manifest literal, so keep `as const satisfies Manifest` on it.
 */
export function defineApp<const M extends Manifest>(manifest: M, handlers: Handlers<M>): App<M> {
  const actions = handlers.actions as AnyApp["handlers"]["actions"];
  const lifecycle = handlers as AnyApp["handlers"];

  const app: AnyApp = {
    manifest,
    handlers: lifecycle,

    async invoke(action, input, options) {
      const { context = {}, observability = {} } = options;
      const handler = actions[action];
      if (!handler) throw new Error(`unknown action "${action}"`);
      const full: CallContext = { ...defaultContext, callId: crypto.randomUUID(), ...context };
      const info = { name: `action ${action}`, tenantId: full.tenantId, installId: full.installId, callId: full.callId };
      const { parent, connect } = remoteOf(options);
      return runCall(info, parent, observability, connect, (traced, log) => handler(input, callCtx(manifest, traced, log, full)));
    },

    async install(options) {
      await runHook("install", lifecycle.install, options);
    },

    async uninstall(options) {
      await runHook("uninstall", lifecycle.uninstall, options);
    },
  };

  async function runHook(
    name: "install" | "uninstall",
    hook: AnyApp["handlers"]["install"],
    options: Omit<LifecycleOptions, "platform"> & Source,
  ) {
    if (!hook) return;
    const { context = {}, observability = {} } = options;
    const full = { ...defaultContext, ...context };
    const { parent, connect } = remoteOf(options);
    await runCall({ name, tenantId: full.tenantId, installId: full.installId }, parent, observability, connect, (traced, log) =>
      hook(installCtx(manifest, traced, log, full)),
    );
  }

  return app as unknown as App<M>;
}
