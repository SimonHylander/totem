import {
  ErrorCode,
  JsonRpcRequest,
  PlatformMethods,
  RpcError,
  SIGNATURE_HEADER,
  SignedPlatformMethods,
  parseOptions,
  parseTrace,
  verify,
  type JsonRpcId,
  type JsonRpcResponse,
} from "@totem/protocol";
import { AppId, InstallId } from "@totem/ids";
import { requireActive, type InstallRepo } from "@totem/installs";
import { Clock, Effect, Schema, Tracer } from "effect";
import { bearerToken } from "./access.js";
import { CallDepth, forward, invoke, type AppTransport } from "@totem/runtime";
import { verifyCallbackToken, type CallbackClaims } from "./callback-token.js";
import { bindPort, connectPort, listApps, listPorts, unbindPort } from "./catalog.js";
import { Connections } from "./connections.js";
import { BadRequest, NotDeclared, type PlatformError } from "./errors.js";
import { Installs, type Install } from "./installs.js";
import { Store, type PlatformConfig } from "./store.js";

// The endpoint apps call (ADR 0008). The callback token names the install, so params carry no tenant.
// Signed methods are the exception: the app signs them with its HMAC secret and names one of its
// installs (ADR 0014, ADR 0015).

type Services = Store | Installs | Connections | PlatformConfig | AppTransport | InstallRepo;

type Methods = {
  [K in keyof PlatformMethods]: (
    claims: CallbackClaims,
    params: PlatformMethods[K]["params"],
  ) => Effect.Effect<PlatformMethods[K]["result"], PlatformError, Services>;
};

const LOG_LEVELS = { debug: "Debug", info: "Info", warn: "Warn", error: "Error" } as const;

const methods: Methods = {
  "credentials/get": (claims, { name }) => Connections.use((connections) => connections.get(claims.installId, name)),

  "state/get": (claims, { key }) =>
    Effect.map(statefulInstall(claims), (install) => {
      const entry = install.state.get(key);
      return { value: entry?.value ?? null, version: entry?.version ?? 0 };
    }),

  "state/set": Effect.fnUntraced(function* (claims, { key, value, version }) {
    yield* statefulInstall(claims);
    return { version: yield* (yield* Installs).setState(claims.installId, key, value, version) };
  }),

  // The app's own line. It runs under the call's span and opens none (ADR 0016).
  log: (claims, { level, message, data }) =>
    Effect.logWithLevel(LOG_LEVELS[level])(message, ...(data ? [data] : [])).pipe(
      Effect.annotateLogs({ source: "app", installId: claims.installId, ...(claims.callId && { callId: claims.callId }) }),
      Effect.as({}),
    ),

  "actions/invoke": Effect.fnUntraced(function* (claims, { port, input }) {
    const caller = yield* (yield* Installs).get(claims.installId);
    return { output: yield* forward(caller, port, input, claims.depth) };
  }),
};

/** The calling install, if its manifest declares state. */
const statefulInstall = Effect.fnUntraced(function* (claims: CallbackClaims) {
  const install = yield* (yield* Installs).get(claims.installId);
  if (install.version.manifest.needs.state !== true) {
    return yield* new NotDeclared({ message: "state is not declared in the manifest" });
  }
  return install;
});

const isMethod = (name: string): name is keyof PlatformMethods => name in methods;

/** Handle one JSON-RPC request from an app. */
export const handlePlatformMethod = Effect.fnUntraced(function* (request: Request) {
  const body = yield* Effect.promise(() => request.text());
  const signature = request.headers.get(SIGNATURE_HEADER);
  if (signature !== null) return yield* handleSigned(signature, body);

  const claims = verifyCallbackToken((yield* Store).callbackKey, bearerToken(request), yield* Clock.currentTimeMillis);
  if (!claims || !(yield* (yield* Installs).lookup(claims.installId))) {
    return reply(null, new RpcError(ErrorCode.Unauthorized, "bad or expired callback token"), 401);
  }
  const parsed = parse(body);
  if (parsed instanceof Response) return parsed;
  if (!isMethod(parsed.method)) {
    return reply(parsed.id, new RpcError(ErrorCode.MethodNotFound, `unknown method "${parsed.method}"`));
  }
  const method = methods[parsed.method] as (
    claims: CallbackClaims,
    params: unknown,
  ) => Effect.Effect<unknown, PlatformError, Services>;
  const handled = Effect.flatMap(decodeParams(PlatformMethods[parsed.method].params, parsed.params), (params) =>
    method(claims, params),
  );

  // The token names the platform span that made the call, so callbacks are its children whatever the
  // app sends. The app's own span, if it is in the same trace, becomes a link (ADR 0016).
  const parent = claims.trace && Tracer.externalSpan(claims.trace);
  if (parsed.method === "log") return yield* run(parsed, parent ? Effect.withParentSpan(handled, parent) : handled);
  const sent = parseTrace(parsed.trace);
  const links = sent && sent.traceId === claims.trace?.traceId ? [{ span: Tracer.externalSpan(sent), attributes: {} }] : [];
  const attributes = { "totem.install_id": claims.installId, ...(claims.callId && { "totem.call_id": claims.callId }) };
  return yield* run(
    parsed,
    handled.pipe(Effect.withSpan(`rpc ${parsed.method}`, { kind: "server", attributes, links, ...(parent && { parent }) })),
  );
});

/**
 * Methods the app signs with its HMAC secret (ADR 0014, ADR 0015). The install is verified before
 * the method runs.
 */
type SignedMethods = {
  [K in keyof SignedPlatformMethods]: (
    install: Install,
    params: SignedPlatformMethods[K]["params"],
  ) => Effect.Effect<SignedPlatformMethods[K]["result"], PlatformError, Services>;
};

const signedMethods: SignedMethods = {
  "actions/start": Effect.fnUntraced(function* (install, { action, input }) {
    const active = yield* Effect.fromResult(requireActive(install));
    return { output: yield* invoke(active, action, input, CallDepth.make(0)) };
  }),

  "apps/list": (install) => Effect.map(listApps(install), (apps) => ({ apps })),

  "ports/list": (install) => Effect.map(listPorts(install), (ports) => ({ ports })),

  "ports/bind": Effect.fnUntraced(function* (install, { port, appId, action }) {
    const provider = yield* Schema.decodeEffect(AppId)(appId).pipe(
      Effect.mapError(() => new BadRequest({ message: "appId is required" })),
    );
    yield* bindPort(install, port, provider, action);
    return {};
  }),

  "ports/unbind": Effect.fnUntraced(function* (install, { port }) {
    yield* unbindPort(install, port);
    return {};
  }),

  "ports/connect": Effect.fnUntraced(function* (install, { port, credential, returnTo }) {
    return { url: yield* connectPort(install, port, credential, returnTo) };
  }),
};

const isSignedMethod = (name: string): name is keyof SignedPlatformMethods => name in signedMethods;

/**
 * A request signed by the app. An unknown install, an install of another app and a bad signature
 * all answer Unauthorized, so signed methods do not reveal which installs exist.
 */
const handleSigned = Effect.fnUntraced(function* (signature: string, body: string) {
  const parsed = parse(body);
  if (parsed instanceof Response) return parsed;
  if (!isSignedMethod(parsed.method)) {
    return reply(parsed.id, new RpcError(ErrorCode.MethodNotFound, `"${parsed.method}" needs a callback token`));
  }
  const decoded = yield* Effect.result(decodeParams(SignedPlatformMethods[parsed.method].params, parsed.params));
  if (decoded._tag === "Failure") return reply(parsed.id, toRpcError(decoded.failure));
  const params = decoded.success;
  const installId = Schema.decodeUnknownOption(InstallId)(params.installId);
  if (installId._tag === "None") {
    return reply(parsed.id, new RpcError(ErrorCode.InvalidParams, "installId is required"));
  }

  const install = yield* (yield* Installs).lookup(installId.value);
  const app = install && (yield* (yield* Store).apps.lookup(install.appId));
  const now = Math.floor((yield* Clock.currentTimeMillis) / 1000);
  if (!install || !app || !(yield* Effect.promise(() => verify(app.secret.reveal(), signature, body, { now })))) {
    return reply(parsed.id, new RpcError(ErrorCode.Unauthorized, "bad signature"), 401);
  }
  const method = signedMethods[parsed.method] as (
    install: Install,
    params: unknown,
  ) => Effect.Effect<unknown, PlatformError, Services>;

  // The signature has verified, so the app's trace member can be the parent (ADR 0016).
  const sent = parseTrace(parsed.trace);
  const attributes = { "totem.install_id": install.id, "totem.app_id": install.appId };
  return yield* run(
    parsed,
    method(install, params).pipe(
      Effect.withSpan(`rpc ${parsed.method}`, { kind: "server", attributes, ...(sent && { parent: Tracer.externalSpan(sent) }) }),
    ),
  );
});

/** Decode a method's params with its protocol schema. A bad param is BadRequest, so InvalidParams on the wire. */
function decodeParams<S extends Schema.Codec<unknown, unknown, never, never>>(
  schema: S,
  params: unknown,
): Effect.Effect<S["Type"], BadRequest> {
  return Schema.decodeUnknownEffect(schema, parseOptions)(params).pipe(
    Effect.mapError((error) => new BadRequest({ message: error.message })),
  );
}

function parse(body: string): JsonRpcRequest | Response {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return reply(null, new RpcError(ErrorCode.ParseError, "invalid JSON"));
  }
  return Schema.is(JsonRpcRequest)(parsed) ? parsed : reply(null, new RpcError(ErrorCode.InvalidRequest, "not a JSON-RPC 2.0 request"));
}

/** The JSON-RPC code for each domain failure. AppFailed keeps the app's own code. */
const RPC_CODES: { [K in Exclude<PlatformError["_tag"], "AppFailed">]: number } = {
  Unauthenticated: ErrorCode.Unauthorized,
  Forbidden: ErrorCode.Unauthorized,
  NotFound: ErrorCode.InvalidParams,
  Conflict: ErrorCode.InvalidParams,
  BadRequest: ErrorCode.InvalidParams,
  NotDeclared: ErrorCode.NotDeclared,
  PortNotDeclared: ErrorCode.NotDeclared,
  ActionNotProvided: ErrorCode.ActionNotFound,
  ForeignInstall: ErrorCode.Unauthorized,
  InstallNotActive: ErrorCode.InvalidRequest,
  IllegalTransition: ErrorCode.InvalidRequest,
  IncompatibleVersion: ErrorCode.InvalidRequest,
  PortUnbound: ErrorCode.PortUnbound,
  CallDepthExceeded: ErrorCode.InvalidRequest,
  CredentialMissing: ErrorCode.CredentialMissing,
  InvalidManifest: ErrorCode.InvalidParams,
  ProviderFailed: ErrorCode.InternalError,
  StateConflict: ErrorCode.StateConflict,
};

function toRpcError(error: PlatformError): RpcError {
  return error._tag === "AppFailed"
    ? new RpcError(error.code, error.message, error.data)
    : new RpcError(RPC_CODES[error._tag], error.message);
}

/** Run a method and wrap its result or error in a JSON-RPC response. Defects answer InternalError. */
function run<R>(request: JsonRpcRequest, method: Effect.Effect<unknown, PlatformError, R>): Effect.Effect<Response, never, R> {
  return method.pipe(
    Effect.map((result) => reply(request.id, { result })),
    Effect.catch((error) => Effect.succeed(reply(request.id, toRpcError(error)))),
    Effect.catchCause((cause) =>
      Effect.logError(`${request.method} failed`, cause).pipe(
        Effect.as(reply(request.id, new RpcError(ErrorCode.InternalError, "internal error"))),
      ),
    ),
  );
}

function reply(id: JsonRpcId, outcome: RpcError | { result: unknown }, status = 200): Response {
  const body: JsonRpcResponse =
    outcome instanceof RpcError ? { jsonrpc: "2.0", id, error: outcome.toJSON() } : { jsonrpc: "2.0", id, ...outcome };
  return Response.json(body, { status });
}
