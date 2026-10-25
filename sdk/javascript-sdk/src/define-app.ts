import type { CallContext, InstallContext, Manifest } from "@totem/protocol";
import type { Platform } from "./platform.js";
import type { ActionInput, ActionName, ActionOutput, CallCtx, Handlers, InstallCtx, Ports } from "./types.js";

type InvokeOptions = {
  platform: Platform;
  context?: Partial<CallContext>;
};

type LifecycleOptions = {
  platform: Platform;
  context?: Partial<InstallContext>;
};

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
  invoke(action: string, input: unknown, options: InvokeOptions): Promise<unknown>;
  install(options: LifecycleOptions): Promise<void>;
  uninstall(options: LifecycleOptions): Promise<void>;
};

const defaultContext: InstallContext = { tenantId: "test-tenant", installId: "test-install", config: {} };

function installCtx(manifest: Manifest, platform: Platform, context: InstallContext): InstallCtx<Manifest> {
  const log = (level: "debug" | "info" | "warn" | "error") => (message: string, data?: Record<string, unknown>) =>
    platform.log(level, message, data);
  return {
    tenantId: context.tenantId,
    installId: context.installId,
    config: context.config,
    credentials: { get: (name) => platform.getCredential(name) },
    log: { debug: log("debug"), info: log("info"), warn: log("warn"), error: log("error") },
    ...(manifest.needs.state && {
      state: {
        get: (key: string) => platform.getState(key),
        set: (key: string, value: unknown) => platform.setState(key, value),
      },
    }),
  };
}

function callCtx(manifest: Manifest, platform: Platform, context: CallContext): CallCtx<Manifest> {
  const ports: Ports<Manifest> = Object.fromEntries(
    Object.keys(manifest.needs.actions ?? {}).map((port) => [port, (input: unknown) => platform.invokePort(port, input)]),
  );
  return {
    ...installCtx(manifest, platform, context),
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

    async invoke(action, input, { platform, context = {} }) {
      const handler = actions[action];
      if (!handler) throw new Error(`unknown action "${action}"`);
      const full: CallContext = { ...defaultContext, callId: crypto.randomUUID(), ...context };
      return handler(input, callCtx(manifest, platform, full));
    },

    async install({ platform, context = {} }) {
      await lifecycle.install?.(installCtx(manifest, platform, { ...defaultContext, ...context }));
    },

    async uninstall({ platform, context = {} }) {
      await lifecycle.uninstall?.(installCtx(manifest, platform, { ...defaultContext, ...context }));
    },
  };

  return app as unknown as App<M>;
}
