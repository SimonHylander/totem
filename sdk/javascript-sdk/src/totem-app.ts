import { ErrorCode, RpcError, type LogLevel, type Manifest as WireManifest } from "@totem/protocol";
import { type Context as Services, Effect, Exit, Layer, Schema, Scope } from "effect";
import { createApp, type App } from "./define-app.js";
import { codecs, parseOptions, type JsonCodec } from "./manifest.js";
import type { ActionName, CallCtx, Credentials, InstallCtx, PortName, State as PromiseState } from "./types.js";

type CodecsOf<S> = S extends { readonly [codecs]: infer C } ? C : never;
type Slot<C, K extends string> = C extends { readonly [P in K]: infer S extends JsonCodec } ? S : never;

type ProvidedOf<M> = M extends { provides: { actions: infer A } } ? A : never;
type NeededOf<M> = M extends { needs: { actions: infer P } } ? P : never;
type Signature<A, K> = K extends keyof A ? CodecsOf<A[K]> : never;

type ConfigType<M> = [Slot<CodecsOf<M>, "config">] extends [never] ? Record<string, unknown> : Slot<CodecsOf<M>, "config">["Type"];

/** A call to the platform. Fails with the platform's error, such as `CredentialMissing`. */
type Call<A> = Effect.Effect<A, RpcError>;

type State = {
  get<T = unknown>(key: string): Call<T | null>;
  /** Write unconditionally. Use `update` when the new value depends on the current one. */
  set(key: string, value: unknown): Call<void>;
  /** Store `f(current)` and return it, retrying when another call wrote the key. `f` can run more than once. */
  update<T>(key: string, f: (current: T | null) => T): Call<T>;
};

type Logger = { [L in LogLevel]: (message: string, data?: Record<string, unknown>) => Call<void> };

/** Available in install and uninstall hooks. */
export type InstallContext<M> = {
  tenantId: string;
  installId: string;
  config: ConfigType<M>;
  credentials: { get<K extends keyof Credentials<M>>(name: K): Call<Credentials<M>[K]> };
  log: Logger;
} & (M extends { needs: { state: true } } ? { state: State } : Record<never, never>);

/** Available in action handlers. Ports take and return decoded values. */
export type Context<M> = InstallContext<M> & {
  callId: string;
  idempotencyKey?: string;
  deadline?: Date;
  ports: {
    [K in PortName<M>]: (input: Slot<Signature<NeededOf<M>, K>, "input">["Type"]) => Call<Slot<Signature<NeededOf<M>, K>, "output">["Type"]>;
  };
};

/** Handlers get decoded input and return decoded output. `R` is what `layer` provides. */
export type Handlers<M, R = never> = {
  actions: {
    [K in ActionName<M>]: (
      input: Slot<Signature<ProvidedOf<M>, K>, "input">["Type"],
      ctx: Context<M>,
    ) => Effect.Effect<Slot<Signature<ProvidedOf<M>, K>, "output">["Type"], RpcError, R>;
  };
  install?: (ctx: InstallContext<M>) => Effect.Effect<void, RpcError, R>;
  uninstall?: (ctx: InstallContext<M>) => Effect.Effect<void, RpcError, R>;
};

export type EffectApp<M extends WireManifest, R> = App<M> & {
  /** The same app on another layer. Tests pass a fake. */
  withLayer<E>(layer: Layer.Layer<R, E>): EffectApp<M, R>;
  /** Close the layer's scope. A long-lived process runs this on shutdown. */
  dispose: Effect.Effect<void>;
};

/** `Handlers` with the manifest's types erased. Dispatch is by name, and the schemas check every value. */
type AnyHandlers = {
  actions: Record<string, (input: unknown, ctx: unknown) => Effect.Effect<unknown, RpcError>>;
  install?: (ctx: unknown) => Effect.Effect<void, RpcError>;
  uninstall?: (ctx: unknown) => Effect.Effect<void, RpcError>;
};

type Built = { handlers: AnyHandlers; services: Services.Context<never>; scope: Scope.Closeable };

type Codecs = { readonly [codecs]: { readonly input: JsonCodec; readonly output: JsonCodec } };

/** The signatures `Totem.Manifest` built, which is the only way to get a manifest with these types. */
const signaturesOf = (signatures: WireManifest["provides"]["actions"]) => Object.entries((signatures ?? {}) as unknown as Record<string, Codecs>);

const call = <A>(run: () => Promise<A>): Call<A> =>
  Effect.tryPromise({
    try: run,
    catch: (error) => (error instanceof RpcError ? error : new RpcError(ErrorCode.InternalError, error instanceof Error ? error.message : String(error))),
  });

const decode = (schema: JsonCodec, value: unknown, code: number, what: string) =>
  Schema.decodeUnknownEffect(schema)(value, parseOptions).pipe(Effect.mapError((error) => new RpcError(code, `invalid ${what}: ${error.message}`)));

const encode = (schema: JsonCodec, value: unknown, what: string) =>
  Schema.encodeUnknownEffect(schema)(value, parseOptions).pipe(Effect.mapError((error) => new RpcError(ErrorCode.InternalError, `invalid ${what}: ${error.message}`)));

function configOf(manifest: WireManifest, config: unknown) {
  const schema = (manifest as { readonly [codecs]?: { readonly config: JsonCodec } })[codecs]?.config;
  return schema ? decode(schema, config, ErrorCode.InvalidParams, "config") : Effect.succeed(config);
}

function installContext(ctx: InstallCtx<WireManifest>, config: unknown) {
  const { state } = ctx as { state?: PromiseState };
  const at = (level: LogLevel) => (message: string, data?: Record<string, unknown>) => call(() => ctx.log[level](message, data));
  return {
    tenantId: ctx.tenantId,
    installId: ctx.installId,
    config,
    credentials: { get: (name: never) => call(() => ctx.credentials.get(name)) },
    log: { debug: at("debug"), info: at("info"), warn: at("warn"), error: at("error") },
    ...(state && {
      state: {
        get: (key: string) => call(() => state.get(key)),
        set: (key: string, value: unknown) => call(() => state.set(key, value)),
        update: (key: string, f: (current: unknown) => unknown) => call(() => state.update(key, f)),
      },
    }),
  };
}

function callContext(manifest: WireManifest, ctx: CallCtx<WireManifest>, config: unknown) {
  const ports = ctx.ports as Record<string, (input: unknown) => Promise<unknown>>;
  return {
    ...installContext(ctx, config),
    callId: ctx.callId,
    ...(ctx.idempotencyKey !== undefined && { idempotencyKey: ctx.idempotencyKey }),
    ...(ctx.deadline !== undefined && { deadline: ctx.deadline }),
    ports: Object.fromEntries(
      signaturesOf(manifest.needs.actions).map(([name, { [codecs]: { input, output } }]) => [
        name,
        Effect.fnUntraced(function* (value: unknown) {
          const port = ports[name];
          if (!port) return yield* Effect.fail(new RpcError(ErrorCode.PortUnbound, `no port "${name}"`));
          const encoded = yield* encode(input, value, `input to port ${name}`);
          const result = yield* call(() => port(encoded));
          return yield* decode(output, result, ErrorCode.InternalError, `output of port ${name}`);
        }),
      ]),
    ),
  };
}

/**
 * Define an app. `build` runs once per process, on the first call that needs it, and again after a
 * failure. The SDK owns `layer`'s scope, so its resources stay open for every call. The manifest is
 * plain data, so `initialize` and `health` never run `build`.
 */
export function App<const M extends WireManifest, R = never, LE = never, BE = never>(
  { manifest, layer }: { readonly manifest: M; readonly layer?: Layer.Layer<R, LE> },
  build: Effect.Effect<Handlers<M, NoInfer<R>>, BE, NoInfer<R>>,
): EffectApp<M, R> {
  const acquire = Effect.gen(function* () {
    const scope = yield* Scope.make();
    return yield* Effect.gen(function* () {
      const services = yield* Layer.buildWithScope((layer ?? Layer.empty) as Layer.Layer<never, unknown>, scope);
      const handlers = yield* Effect.provide(build as unknown as Effect.Effect<AnyHandlers, unknown>, services);
      return { handlers, services, scope } satisfies Built;
    }).pipe(Effect.onError(() => Scope.close(scope, Exit.void)));
  });

  // Detached from any one call. Every call shares the result, so one caller's interruption must not
  // close resources the others hold. A failed attempt is forgotten, so the next call retries.
  let built: Promise<Built> | undefined;
  const ready = Effect.tryPromise({
    try: () =>
      (built ??= Effect.runPromise(acquire).catch((error: unknown) => {
        built = undefined;
        throw error;
      })),
    catch: (error) => error,
  });

  const hook = (name: "install" | "uninstall") =>
    Effect.fnUntraced(function* (ctx: InstallCtx<WireManifest>) {
      const { handlers, services } = yield* ready;
      const run = handlers[name];
      if (run) yield* Effect.provide(run(installContext(ctx, yield* configOf(manifest, ctx.config))), services);
    });

  const app = createApp(manifest, {
    actions: Object.fromEntries(
      signaturesOf(manifest.provides.actions).map(([name, { [codecs]: { input, output } }]) => [
        name,
        Effect.fnUntraced(function* (raw: unknown, ctx: CallCtx<WireManifest>) {
          const decoded = yield* decode(input, raw, ErrorCode.InvalidParams, `input to ${name}`);
          const config = yield* configOf(manifest, ctx.config);
          const { handlers, services } = yield* ready;
          const handler = handlers.actions[name];
          if (!handler) return yield* Effect.fail(new RpcError(ErrorCode.ActionNotFound, `unknown action "${name}"`));
          const result = yield* Effect.provide(handler(decoded, callContext(manifest, ctx, config)), services);
          return yield* encode(output, result, `output of ${name}`);
        }),
      ]),
    ),
    install: hook("install"),
    uninstall: hook("uninstall"),
  });

  return Object.assign(app, {
    withLayer: <E>(next: Layer.Layer<R, E>) => App({ manifest, layer: next }, build),
    dispose: Effect.suspend(() => {
      const closing = built;
      built = undefined;
      if (!closing) return Effect.void;
      return Effect.tryPromise(() => closing).pipe(
        Effect.flatMap(({ scope }) => Scope.close(scope, Exit.void)),
        Effect.ignore,
      );
    }),
  });
}
