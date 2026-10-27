import {
  ErrorCode,
  RpcError,
  SIGNATURE_HEADER,
  isJsonRpcRequest,
  verify,
  type JsonRpcId,
  type JsonRpcRequest,
  type JsonRpcResponse,
  type PlatformMethods,
  type SignedPlatformMethods,
} from "@totem/protocol";
import { Clock, Effect } from "effect";
import { bearerToken } from "./access.js";
import { forwardPortCall, getInstall, manifestOf, runAction } from "./apps.js";
import { verifyCallbackToken, type CallbackClaims } from "./callback-token.js";
import { bindPort, connectPort, listApps, listPorts, unbindPort } from "./catalog.js";
import { getCredential } from "./connections.js";
import { BadRequest, NotDeclared, type PlatformError } from "./errors.js";
import { Store, type Install, type PlatformConfig } from "./store.js";

// The endpoint apps call (ADR 0008). The callback token names the install, so params carry no tenant.
// Signed methods are the exception: the app signs them with its HMAC secret and names one of its
// installs (ADR 0014, ADR 0015).

type Services = Store | PlatformConfig;

type Methods = {
  [K in keyof PlatformMethods]: (
    claims: CallbackClaims,
    params: PlatformMethods[K]["params"],
  ) => Effect.Effect<PlatformMethods[K]["result"], PlatformError, Services>;
};

const LOG_LEVELS = { debug: "Debug", info: "Info", warn: "Warn", error: "Error" } as const;

const methods: Methods = {
  "credentials/get": (claims, { name }) => getCredential(claims, name),

  "state/get": (claims, { key }) => Effect.map(stateOf(claims), (state) => ({ value: state.get(key) ?? null })),

  "state/set": (claims, { key, value }) =>
    Effect.map(stateOf(claims), (state) => {
      if (value === null) state.delete(key);
      else state.set(key, value);
      return {};
    }),

  log: (claims, { level, message, data }) =>
    Effect.logWithLevel(LOG_LEVELS[level])(message, data ?? "").pipe(
      Effect.annotateLogs({ installId: claims.installId, callId: claims.callId ?? "" }),
      Effect.as({}),
    ),

  "actions/invoke": (claims, { port, input }) =>
    Effect.map(forwardPortCall(claims, port, input), (output) => ({ output })),
};

const stateOf = Effect.fnUntraced(function* (claims: CallbackClaims) {
  const install = yield* getInstall(claims.installId);
  if ((yield* manifestOf(install)).needs.state !== true) {
    return yield* new NotDeclared({ message: "state is not declared in the manifest" });
  }
  return install.state;
});

const isMethod = (name: string): name is keyof PlatformMethods => name in methods;

/** Handle one JSON-RPC request from an app. */
export const handlePlatformMethod = Effect.fnUntraced(function* (request: Request) {
  const body = yield* Effect.promise(() => request.text());
  const signature = request.headers.get(SIGNATURE_HEADER);
  if (signature !== null) return yield* handleSigned(signature, body);

  const store = yield* Store;
  const claims = verifyCallbackToken(store.callbackKey, bearerToken(request), yield* Clock.currentTimeMillis);
  if (!claims || !store.installs.has(claims.installId)) {
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
  return yield* run(parsed, method(claims, parsed.params));
});

type Params = Record<string, unknown>;

/**
 * Methods the app signs with its HMAC secret (ADR 0014, ADR 0015). The install is verified before
 * the method runs, and each method checks its own remaining params.
 */
type SignedMethods = {
  [K in keyof SignedPlatformMethods]: (
    install: Install,
    params: Params,
  ) => Effect.Effect<SignedPlatformMethods[K]["result"], PlatformError, Services>;
};

const signedMethods: SignedMethods = {
  "actions/start": Effect.fnUntraced(function* (install, params) {
    if (!("input" in params)) return yield* new BadRequest({ message: "input is required" });
    return { output: yield* runAction(install, yield* string(params, "action"), params["input"], 0) };
  }),

  "apps/list": (install) => Effect.map(listApps(install), (apps) => ({ apps })),

  "ports/list": (install) => Effect.map(listPorts(install), (ports) => ({ ports })),

  "ports/bind": Effect.fnUntraced(function* (install, params) {
    yield* bindPort(install, yield* string(params, "port"), yield* string(params, "appId"), yield* string(params, "action"));
    return {};
  }),

  "ports/unbind": Effect.fnUntraced(function* (install, params) {
    yield* unbindPort(install, yield* string(params, "port"));
    return {};
  }),

  "ports/connect": Effect.fnUntraced(function* (install, params) {
    const port = yield* string(params, "port");
    const url = yield* connectPort(install, port, yield* string(params, "credential"), yield* string(params, "returnTo"));
    return { url };
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
  const params: Params = isObject(parsed.params) ? parsed.params : {};
  const installId = params["installId"];
  if (typeof installId !== "string") {
    return reply(parsed.id, new RpcError(ErrorCode.InvalidParams, "installId is required"));
  }

  const store = yield* Store;
  const install = store.installs.get(installId);
  const app = install && store.apps.get(install.appId);
  const now = Math.floor((yield* Clock.currentTimeMillis) / 1000);
  if (!install || !app || !(yield* Effect.promise(() => verify(app.secret.reveal(), signature, body, { now })))) {
    return reply(parsed.id, new RpcError(ErrorCode.Unauthorized, "bad signature"), 401);
  }
  const method = signedMethods[parsed.method] as (
    install: Install,
    params: Params,
  ) => Effect.Effect<unknown, PlatformError, Services>;
  return yield* run(parsed, method(install, params));
});

function isObject(value: unknown): value is Params {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A required non-empty string param. */
function string(params: Params, field: string): Effect.Effect<string, BadRequest> {
  const value = params[field];
  return typeof value === "string" && value !== ""
    ? Effect.succeed(value)
    : Effect.fail(new BadRequest({ message: `${field} is required` }));
}

function parse(body: string): JsonRpcRequest | Response {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return reply(null, new RpcError(ErrorCode.ParseError, "invalid JSON"));
  }
  return isJsonRpcRequest(parsed) ? parsed : reply(null, new RpcError(ErrorCode.InvalidRequest, "not a JSON-RPC 2.0 request"));
}

/** The JSON-RPC code for each domain failure. AppFailed keeps the app's own code. */
const RPC_CODES: { [K in Exclude<PlatformError["_tag"], "AppFailed">]: number } = {
  Unauthenticated: ErrorCode.Unauthorized,
  Forbidden: ErrorCode.Unauthorized,
  NotFound: ErrorCode.InvalidParams,
  Conflict: ErrorCode.InvalidParams,
  BadRequest: ErrorCode.InvalidParams,
  NotDeclared: ErrorCode.NotDeclared,
  ActionNotProvided: ErrorCode.ActionNotFound,
  PortUnbound: ErrorCode.PortUnbound,
  CallDepthExceeded: ErrorCode.InvalidRequest,
  CredentialMissing: ErrorCode.CredentialMissing,
  InvalidManifest: ErrorCode.InvalidParams,
  ProviderFailed: ErrorCode.InternalError,
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
