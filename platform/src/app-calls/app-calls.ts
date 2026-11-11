import { CallId } from "@totem/ids";
import { AppMethods, RpcError, SIGNATURE_HEADER, formatTrace, rpc, sign, type TraceParent } from "@totem/protocol";
import { AppFailed, AppTransport } from "@totem/runtime";
import { Clock, Effect, Layer, Schema } from "effect";
import { FetchHttpClient } from "effect/http";
import { Apps, type AppRecord } from "../apps/apps.js";
import { CallbackKey, mintCallbackToken } from "./callback-token.js";
import type { Install } from "../installs/installs.js";

export const appTransportLayer = Layer.effect(
  AppTransport,
  Effect.gen(function* () {
    const apps = yield* Apps;
    const callbackKey = yield* CallbackKey;
    return AppTransport.of({
      invoke: Effect.fnUntraced(function* (install, action, input, depth) {
        const callId = CallId.make(crypto.randomUUID());
        const now = yield* Clock.currentTimeMillis;
        const attributes = { ...attributesOf(install), "totem.call_id": callId, "totem.action": action, "totem.depth": depth };
        const app = yield* apps.get(install.appId).pipe(Effect.orDie);
        const { output } = yield* callApp(app, "actions/invoke", `invoke ${action}`, attributes, (trace) => ({
          action,
          input,
          context: { tenantId: install.tenantId, installId: install.id, config: install.config, callId },
          callbackToken: mintCallbackToken(callbackKey, { installId: install.id, callId, depth, trace }, now),
        })).pipe(Effect.catchTag("SchemaError", Effect.die));
        return output;
      }),
    });
  }),
);

export const attributesOf = (install: Pick<Install, "tenantId" | "id" | "appId">) => ({
  "totem.tenant_id": install.tenantId,
  "totem.install_id": install.id,
  "totem.app_id": install.appId,
});

/**
 * Signed JSON-RPC call to an app (ADR 0008) in a client span named `name`. The span goes to the app
 * as the request's trace member, and `params` gets it to mint into the callback token, so the app's
 * callbacks land under this span (ADR 0016).
 */
export function callApp<M extends keyof AppMethods>(
  app: AppRecord,
  method: M,
  name: string,
  attributes: Record<string, unknown>,
  params: (trace: TraceParent) => AppMethods[M]["params"],
): Effect.Effect<AppMethods[M]["result"], AppFailed | Schema.SchemaError> {
  return Effect.useSpan(name, { kind: "client", attributes }, (span) =>
    Effect.gen(function* () {
      const fetch = yield* FetchHttpClient.Fetch;
      const timestamp = Math.floor((yield* Clock.currentTimeMillis) / 1000);
      return yield* Effect.tryPromise({
        try: () =>
          rpc(app.url, AppMethods, method, params(span), {
            // eslint-disable-next-line no-restricted-syntax -- rpc's signing callback is async
            sign: async (body) => ({ [SIGNATURE_HEADER]: await sign(app.secret.reveal(), body, timestamp) }),
            trace: formatTrace(span),
            fetch,
          }),
        catch: (error) => error,
      });
    }),
  ).pipe(
    Effect.catch((error): Effect.Effect<never, AppFailed | Schema.SchemaError> =>
      error instanceof RpcError
        ? Effect.fail(new AppFailed({ code: error.code, message: error.message, data: error.data }))
        : Schema.isSchemaError(error)
          ? Effect.fail(error)
          : Effect.die(error),
    ),
  );
}
