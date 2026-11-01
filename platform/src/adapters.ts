import { CallId } from "@totem/ids";
import { InstallRepo } from "@totem/installs";
import { RpcError, SIGNATURE_HEADER, formatTrace, rpc, sign, type AppMethods, type TraceParent } from "@totem/protocol";
import { AppFailed, AppTransport } from "@totem/runtime";
import { Clock, Effect, Layer } from "effect";
import { FetchHttpClient } from "effect/http";
import { mintCallbackToken } from "./callback-token.js";
import { Store, type AppRecord, type Install } from "./store.js";

// The platform's adapters for the domain ports: the Store as InstallRepo, and signed JSON-RPC over
// HTTP as AppTransport.

/** Installs from the Store. */
export const installRepoLayer = Layer.effect(
  InstallRepo,
  Effect.gen(function* () {
    const { installs } = yield* Store;
    return InstallRepo.of({ lookup: (id) => installs.lookup(id) });
  }),
);

/** Actions run as `actions/invoke` with a fresh call ID and a callback token that carries the depth. */
export const appTransportLayer = Layer.effect(
  AppTransport,
  Effect.gen(function* () {
    const { apps, callbackKey } = yield* Store;
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
        }));
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
 * callbacks land under this span (ADR 0016). A JSON-RPC error fails with AppFailed, anything else dies.
 */
export function callApp<M extends keyof AppMethods>(
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
