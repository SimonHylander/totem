import { type Cause, Effect, Schema } from "effect";
import { JsonRpcRequest, RpcError, decodeParams, type JsonRpcId, type JsonRpcResponse } from "./jsonrpc.js";
import { parseTrace, type TraceParent } from "./trace.js";
import { ErrorCode, type MethodSchemas, type MethodTypes } from "./types.js";

/** A failed signature or token check. The endpoint answers HTTP 401 with an `Unauthorized` envelope. */
export class Unauthorized extends Schema.TaggedError<Unauthorized>()("Unauthorized", { message: Schema.String }) {}

export type EndpointCall<A> = {
  readonly method: string;
  /** What `authenticate` returned. */
  readonly auth: A;
  /** The span the request continues. Read only once the request has authenticated (ADR 0016). */
  readonly trace: TraceParent | undefined;
};

/** Handlers for a method table such as `AppMethods`. Each gets its params decoded with the method's schema. */
export type MethodHandlers<T extends MethodSchemas, A, E, R> = {
  readonly [K in keyof T]: (
    params: MethodTypes<T>[K]["params"],
    call: EndpointCall<A>,
  ) => Effect.Effect<MethodTypes<T>[K]["result"], E, R>;
};

/**
 * When a request authenticates. `beforeParse` sees only the raw request, so its failure answers with
 * a null id. `afterLookup` runs once the params have decoded and can read them, for example to pick
 * the secret. Its failure answers with the request's id, and an `RpcError` from it answers HTTP 200.
 */
export type Authenticate<A, R, P> =
  | { readonly beforeParse: (request: Request, body: string) => Effect.Effect<A, Unauthorized, R> }
  | { readonly afterLookup: (request: Request, body: string, params: P) => Effect.Effect<A, Unauthorized | RpcError, R> };

export type EndpointOptions<T extends MethodSchemas, A, E, R> = {
  readonly schemas: T;
  /** A `MethodHandlers<T, A, E, R>`. Results go out as they are, so their type is not checked here. */
  readonly methods: {
    readonly [K in keyof NoInfer<T>]: (params: MethodTypes<NoInfer<T>>[K]["params"], call: EndpointCall<A>) => Effect.Effect<unknown, E, R>;
  };
  readonly authenticate: Authenticate<A, R, MethodTypes<T>[keyof T]["params"]>;
  /** The error a handler failure answers with. Without it, a failure that is not an `RpcError` is a defect. */
  readonly toRpcError?: (error: E) => RpcError;
  /** Wraps every handler, for example in a span. */
  readonly around?: <X>(handled: Effect.Effect<X, E, R>, call: EndpointCall<A>) => Effect.Effect<X, E, R>;
  /** Logs a defect, which then answers InternalError. Defaults to `Effect.logError`. */
  readonly onDefect?: (method: string, cause: Cause.Cause<unknown>) => Effect.Effect<void, never, R>;
  /** The message for a method missing from `methods`. */
  readonly unknownMethod?: (method: string) => string;
};

class Rejected {
  constructor(readonly response: Response) {}
}

/** Turn a JSON-RPC request into its response envelope. */
export function endpoint<T extends MethodSchemas, A, E, R>({
  schemas,
  methods,
  authenticate,
  toRpcError,
  around,
  onDefect = (method, cause) => Effect.logError(`${method} failed`, cause),
  unknownMethod = (method) => `unknown method "${method}"`,
}: EndpointOptions<T, A, E, R>): (request: Request) => Effect.Effect<Response, never, R> {
  const reject = (id: JsonRpcId, error: Unauthorized | RpcError) =>
    new Rejected(
      error instanceof Unauthorized
        ? reply(id, new RpcError(ErrorCode.Unauthorized, error.message), 401)
        : reply(id, error),
    );

  return Effect.fnUntraced(
    function* (request: Request) {
      const body = yield* Effect.promise(() => request.text());
      let authenticated: (id: JsonRpcId, params: MethodTypes<T>[keyof T]["params"]) => Effect.Effect<A, Rejected, R>;
      if ("beforeParse" in authenticate) {
        const auth = yield* Effect.mapError(authenticate.beforeParse(request, body), (error) => reject(null, error));
        authenticated = () => Effect.succeed(auth);
      } else {
        authenticated = (id, params) => Effect.mapError(authenticate.afterLookup(request, body, params), (error) => reject(id, error));
      }

      const envelope = parse(body);
      if (envelope instanceof RpcError) return yield* Effect.fail(reject(null, envelope));
      if (!Object.hasOwn(methods, envelope.method)) {
        return yield* Effect.fail(reject(envelope.id, new RpcError(ErrorCode.MethodNotFound, unknownMethod(envelope.method))));
      }
      const method = envelope.method as keyof T & string;
      const params = decodeParams(schemas, method, envelope.params);
      if (params._tag === "Failure") return yield* Effect.fail(reject(envelope.id, params.failure));
      const auth = yield* authenticated(envelope.id, params.success);
      const call = { method, auth, trace: parseTrace(envelope.trace) };
      const handled = (methods[method] as (params: unknown, call: EndpointCall<A>) => Effect.Effect<unknown, E, R>)(params.success, call);
      return yield* (around ? around(handled, call) : handled).pipe(
        Effect.map((result) => reply(envelope.id, { result })),
        Effect.catch((error) => {
          const rpcError = toRpcError ? toRpcError(error) : error;
          return rpcError instanceof RpcError ? Effect.succeed(reply(envelope.id, rpcError)) : Effect.die(error);
        }),
        Effect.catchCause((cause) =>
          Effect.as(onDefect(envelope.method, cause), reply(envelope.id, new RpcError(ErrorCode.InternalError, "internal error"))),
        ),
      );
    },
    Effect.catch((rejected) => Effect.succeed(rejected.response)),
  );
}

function parse(body: string): JsonRpcRequest | RpcError {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return new RpcError(ErrorCode.ParseError, "invalid JSON");
  }
  return Schema.is(JsonRpcRequest)(parsed) ? parsed : new RpcError(ErrorCode.InvalidRequest, "not a JSON-RPC 2.0 request");
}

function reply(id: JsonRpcId, outcome: RpcError | { result: unknown }, status = 200): Response {
  const body: JsonRpcResponse =
    outcome instanceof RpcError ? { jsonrpc: "2.0", id, error: outcome.toJSON() } : { jsonrpc: "2.0", id, ...outcome };
  return Response.json(body, { status });
}
