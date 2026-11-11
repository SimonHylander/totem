import {
  AppMethods,
  ErrorCode,
  PROTOCOL_VERSION,
  RpcError,
  SIGNATURE_HEADER,
  Unauthorized,
  endpoint,
  verify,
  type EndpointCall,
  type Manifest,
  type TraceParent,
} from "@totem/protocol";
import { Cause, Effect, Record } from "effect";
import type { AnyApp, App, Remote } from "./define-app.js";
import { logFailure, type Observability } from "./observability.js";
import { platformClient } from "./platform.js";

type HandlerOptions = {
  /** Shared secret issued by the platform at registration. Verifies every request. */
  secret: string;
  /** Known before `initialize` runs, for apps restarted after registration. */
  platformUrl?: string;
  fetch?: typeof fetch;
  observability?: Observability;
};

/**
 * The driving adapter. Turns a signed JSON-RPC request into handler calls
 * and a JSON-RPC response. Framework free: `Request` in, `Response` out.
 */
export function createHandler<M extends Manifest>(typedApp: App<M>, options: HandlerOptions) {
  const app = typedApp as unknown as AnyApp;
  let platformUrl = options.platformUrl;

  const observability = options.observability ?? {};

  /** Callbacks for one call, each naming the call's span in its `trace` member. */
  const remoteFor = (token: string, parent: TraceParent | undefined): Remote => {
    const url = platformUrl;
    if (!url) throw new RpcError(ErrorCode.InvalidRequest, "platformUrl unknown; call initialize first");
    return { parent, connect: (trace) => platformClient({ url, token, trace, ...(options.fetch && { fetch: options.fetch }) }) };
  };

  const methods: {
    [K in keyof AppMethods]: (params: AppMethods[K]["params"], parent: TraceParent | undefined) => Promise<AppMethods[K]["result"]>;
  } = {
    async initialize({ protocolVersion, platformUrl: url }) {
      if (protocolVersion !== PROTOCOL_VERSION) {
        throw new RpcError(ErrorCode.ProtocolVersionUnsupported, `app speaks protocol ${PROTOCOL_VERSION}`);
      }
      platformUrl = url;
      return { manifest: app.manifest };
    },

    async health() {
      return { status: "ok" };
    },

    async install({ context, callbackToken }, parent) {
      if (!app.implementation.install) throw new RpcError(ErrorCode.MethodNotFound, "install not implemented");
      await app.install({ remote: remoteFor(callbackToken, parent), context, observability });
      return {};
    },

    async uninstall({ context, callbackToken }, parent) {
      if (!app.implementation.uninstall) throw new RpcError(ErrorCode.MethodNotFound, "uninstall not implemented");
      await app.uninstall({ remote: remoteFor(callbackToken, parent), context, observability });
      return {};
    },

    async "actions/invoke"({ action, input, context, callbackToken }, parent) {
      if (!(action in app.implementation.actions)) {
        throw new RpcError(ErrorCode.ActionNotFound, `unknown action "${action}"`);
      }
      const output = await app.invoke(action, input, { remote: remoteFor(callbackToken, parent), context, observability });
      return { output };
    },
  };

  const handle = endpoint({
    schemas: AppMethods,
    methods: Record.map(methods, (method) => (params: unknown, { trace }: EndpointCall<void>) =>
      Effect.tryPromise({ try: (): Promise<unknown> => method(params as never, trace), catch: (error) => error }),
    ),
    authenticate: {
      beforeParse: (request, body) =>
        Effect.flatMap(
          Effect.promise(() => verify(options.secret, request.headers.get(SIGNATURE_HEADER), body)),
          (verified) => (verified ? Effect.void : Effect.fail(new Unauthorized({ message: "bad signature" }))),
        ),
    },
    onDefect: (method, cause) => Effect.promise(() => logFailure(observability, `[totem] ${method} failed`, Cause.squash(cause))),
  });

  return (request: Request): Promise<Response> =>
    request.method === "POST" ? Effect.runPromise(handle(request)) : Promise.resolve(new Response(null, { status: 405 }));
}
