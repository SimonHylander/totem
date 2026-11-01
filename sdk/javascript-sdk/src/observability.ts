import { formatTrace, type LogLevel, type PlatformMethods, type TraceMetadata, type TraceParent } from "@totem/protocol";
import { Effect, type ManagedRuntime, Tracer } from "effect";
import type { Platform } from "./platform.js";

/**
 * How an app exports its own telemetry (ADR 0016). Each call runs in an `action <name>` span under
 * the platform's span, and every callback names that span in its `trace` member.
 */
export type Observability = {
  /**
   * Supplies the logger and tracer, such as OTLP layers or a vendor `Tracer`. The SDK borrows it
   * and never disposes it. Without one, logs go to Effect's console logger and spans are not exported.
   */
  runtime?: ManagedRuntime.ManagedRuntime<never, unknown>;
  /**
   * Where `ctx.log` lines go. `"platform"`, the default, sends them to the `log` method. `"local"`
   * writes them to the runtime's logger. `"both"` does both.
   */
  logs?: "platform" | "local" | "both";
};

/** The call being run, as its span and log lines name it. */
export type CallInfo = { name: string; installId: string; tenantId: string; callId?: string };

/**
 * Run `work` in a server span under `parent`, the span the platform sent. `work` gets a Platform
 * whose calls are client spans of it, except `log`, and a port call is named after its port. It
 * also gets a log function that follows `observability.logs`. `connect` builds the Platform for
 * this span. The original error of `work` is rethrown unchanged.
 */
export function runCall<A>(
  info: CallInfo,
  parent: TraceParent | undefined,
  observability: Observability,
  connect: (trace: TraceMetadata) => Platform,
  work: (platform: Platform, log: (level: LogLevel, message: string, data?: Record<string, unknown>) => Promise<void>) => Promise<A>,
): Promise<A> {
  const run = <B>(effect: Effect.Effect<B, unknown>) =>
    observability.runtime ? observability.runtime.runPromise(effect) : Effect.runPromise(effect);
  const ids = { installId: info.installId, ...(info.callId !== undefined && { callId: info.callId }) };

  return run(
    Effect.useSpan(
      info.name,
      {
        kind: "server",
        ...(parent && { parent: Tracer.externalSpan(parent) }),
        attributes: { "totem.tenant_id": info.tenantId, "totem.install_id": info.installId, ...(info.callId && { "totem.call_id": info.callId }) },
      },
      (span) => {
        const platform = connect(formatTrace(span));
        const client = <B>(name: string, call: () => Promise<B>) =>
          run(Effect.tryPromise({ try: call, catch: (error) => error }).pipe(Effect.withSpan(name, { kind: "client", parent: span })));
        const traced: Platform = {
          call: (method, params) => {
            if (method === "log") return platform.call(method, params);
            const named: PlatformMethods[keyof PlatformMethods]["params"] = params;
            return client("port" in named ? `port ${named.port}` : method, () => platform.call(method, params));
          },
        };
        const destination = observability.logs ?? "platform";
        const log = async (level: LogLevel, message: string, data?: Record<string, unknown>) => {
          if (destination !== "platform") {
            await run(
              Effect.logWithLevel(LOG_LEVELS[level])(message, ...(data ? [data] : [])).pipe(
                Effect.annotateLogs({ ...ids, traceId: span.traceId, spanId: span.spanId }),
                Effect.withParentSpan(span),
              ),
            );
          }
          if (destination !== "local") await platform.call("log", { level, message, data });
        };
        return Effect.tryPromise({ try: () => work(traced, log), catch: (error) => error });
      },
    ),
  );
}

/** Log a failure the SDK caught, through the app's logger. Never sent to the platform. */
export function logFailure(observability: Observability, message: string, error: unknown): Promise<void> {
  const effect = Effect.logError(message, error);
  return observability.runtime ? observability.runtime.runPromise(effect) : Effect.runPromise(effect);
}

/** Run a signed call to the platform in a client span and hand `call` the span's trace member. */
export function runSigned<A>(observability: Observability, name: string, call: (trace: TraceMetadata) => Promise<A>): Promise<A> {
  const effect = Effect.useSpan(name, { kind: "client" }, (span) =>
    Effect.tryPromise({ try: () => call(formatTrace(span)), catch: (error) => error }),
  );
  return observability.runtime ? observability.runtime.runPromise(effect) : Effect.runPromise(effect);
}

const LOG_LEVELS = { debug: "Debug", info: "Info", warn: "Warn", error: "Error" } as const;
