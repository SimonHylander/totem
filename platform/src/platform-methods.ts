import {
  ErrorCode,
  PlatformMethods,
  RpcError,
  SIGNATURE_HEADER,
  SignedPlatformMethods,
  Unauthorized,
  endpoint,
  verify,
  type MethodHandlers,
} from "@totem/protocol";
import { AppId, InstallId } from "@totem/ids";
import { requireActive } from "@totem/installs";
import { Clock, Effect, Schema, Tracer } from "effect";
import { bearerToken } from "./access.js";
import { CallDepth, forward, invoke } from "@totem/runtime";
import { Apps } from "./apps.js";
import { CallbackKey, verifyCallbackToken, type CallbackClaims } from "./callback-token.js";
import { bindPort, connectPort, listApps, listPorts, unbindPort } from "./catalog.js";
import { Connections } from "./connections.js";
import { BadRequest, NotDeclared, type PlatformError } from "./errors.js";
import { Installs, type Install } from "./installs.js";
import type { Services } from "./platform.js";

// The endpoint apps call (ADR 0008). The callback token names the install, so params carry no tenant.
// Signed methods are the exception: the app signs them with its HMAC secret and names one of its
// installs (ADR 0014, ADR 0015).

const LOG_LEVELS = { debug: "Debug", info: "Info", warn: "Warn", error: "Error" } as const;

const methods: MethodHandlers<typeof PlatformMethods, CallbackClaims, PlatformError, Services> = {
  "credentials/get": ({ name }, { auth: claims }) => Connections.use((connections) => connections.get(claims.installId, name)),

  "state/get": ({ key }, { auth: claims }) =>
    Effect.map(statefulInstall(claims), (install) => {
      const entry = install.state.get(key);
      return { value: entry?.value ?? null, version: entry?.version ?? 0 };
    }),

  "state/set": Effect.fnUntraced(function* ({ key, value, version }, { auth: claims }) {
    yield* statefulInstall(claims);
    return { version: yield* (yield* Installs).setState(claims.installId, key, value, version) };
  }),

  // The app's own line. It runs under the call's span and opens none (ADR 0016).
  log: ({ level, message, data }, { auth: claims }) =>
    Effect.logWithLevel(LOG_LEVELS[level])(message, ...(data ? [data] : [])).pipe(
      Effect.annotateLogs({ source: "app", installId: claims.installId, ...(claims.callId && { callId: claims.callId }) }),
      Effect.as({}),
    ),

  "actions/invoke": Effect.fnUntraced(function* ({ port, input }, { auth: claims }) {
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

/** Handle one JSON-RPC request from an app. */
export const handlePlatformMethod = (request: Request) =>
  request.headers.get(SIGNATURE_HEADER) !== null ? signedEndpoint(request) : callbackEndpoint(request);

const callbackEndpoint = endpoint({
  schemas: PlatformMethods,
  methods,
  authenticate: {
    beforeParse: Effect.fnUntraced(function* (request: Request) {
      const claims = verifyCallbackToken(yield* CallbackKey, bearerToken(request), yield* Clock.currentTimeMillis);
      if (!claims || !(yield* (yield* Installs).lookup(claims.installId))) {
        return yield* new Unauthorized({ message: "bad or expired callback token" });
      }
      return claims;
    }),
  },
  toRpcError,
  // The token names the platform span that made the call, so callbacks are its children whatever the
  // app sends. The app's own span, if it is in the same trace, becomes a link (ADR 0016).
  around: (handled, { method, auth: claims, trace }) => {
    const parent = claims.trace && Tracer.externalSpan(claims.trace);
    if (method === "log") return parent ? Effect.withParentSpan(handled, parent) : handled;
    const links = trace && trace.traceId === claims.trace?.traceId ? [{ span: Tracer.externalSpan(trace), attributes: {} }] : [];
    const attributes = { "totem.install_id": claims.installId, ...(claims.callId && { "totem.call_id": claims.callId }) };
    return handled.pipe(Effect.withSpan(`rpc ${method}`, { kind: "server", attributes, links, ...(parent && { parent }) }));
  },
});

/**
 * Methods the app signs with its HMAC secret (ADR 0014, ADR 0015). The install is verified before
 * the method runs.
 */
const signedMethods: MethodHandlers<typeof SignedPlatformMethods, Install, PlatformError, Services> = {
  "actions/start": Effect.fnUntraced(function* ({ action, input }, { auth: install }) {
    const active = yield* Effect.fromResult(requireActive(install));
    return { output: yield* invoke(active, action, input, CallDepth.make(0)) };
  }),

  "apps/list": (_params, { auth: install }) => Effect.map(listApps(install), (apps) => ({ apps })),

  "ports/list": (_params, { auth: install }) => Effect.map(listPorts(install), (ports) => ({ ports })),

  "ports/bind": Effect.fnUntraced(function* ({ port, appId, action }, { auth: install }) {
    const provider = yield* Schema.decodeEffect(AppId)(appId).pipe(
      Effect.mapError(() => new BadRequest({ message: "appId is required" })),
    );
    yield* bindPort(install, port, provider, action);
    return {};
  }),

  "ports/unbind": Effect.fnUntraced(function* ({ port }, { auth: install }) {
    yield* unbindPort(install, port);
    return {};
  }),

  "ports/connect": Effect.fnUntraced(function* ({ port, credential, returnTo }, { auth: install }) {
    return { url: yield* connectPort(install, port, credential, returnTo) };
  }),
};

/**
 * A request signed by the app. An unknown install, an install of another app and a bad signature
 * all answer Unauthorized, so signed methods do not reveal which installs exist.
 */
const signedEndpoint = endpoint({
  schemas: SignedPlatformMethods,
  methods: signedMethods,
  authenticate: {
    afterLookup: Effect.fnUntraced(function* (request: Request, body: string, { installId: id }: { installId: string }) {
      const installId = Schema.decodeUnknownOption(InstallId)(id);
      if (installId._tag === "None") return yield* Effect.fail(new RpcError(ErrorCode.InvalidParams, "installId is required"));

      const install = yield* (yield* Installs).lookup(installId.value);
      const app = install && (yield* (yield* Apps).lookup(install.appId));
      const now = Math.floor((yield* Clock.currentTimeMillis) / 1000);
      const signature = request.headers.get(SIGNATURE_HEADER);
      if (!install || !app || !(yield* Effect.promise(() => verify(app.secret.reveal(), signature, body, { now })))) {
        return yield* new Unauthorized({ message: "bad signature" });
      }
      return install;
    }),
  },
  toRpcError,
  // The signature has verified, so the app's trace member can be the parent (ADR 0016).
  around: (handled, { method, auth: install, trace }) =>
    handled.pipe(
      Effect.withSpan(`rpc ${method}`, {
        kind: "server",
        attributes: { "totem.install_id": install.id, "totem.app_id": install.appId },
        ...(trace && { parent: Tracer.externalSpan(trace) }),
      }),
    ),
  unknownMethod: (method) => `"${method}" needs a callback token`,
});

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
