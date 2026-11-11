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
import { InstallId } from "@totem/ids";
import { Clock, Effect, Schema, Tracer } from "effect";
import { bearerToken } from "../access/access.js";
import { CallbackKey, verifyCallbackToken, type CallbackClaims } from "../app-calls/callback-token.js";
import { Apps } from "../apps/apps.js";
import { signedMethods as appSignedMethods } from "../apps/methods.js";
import { methods as connectionMethods } from "../connections/methods.js";
import type { PlatformError } from "../errors.js";
import { Installs, type Install } from "../installs/installs.js";
import { methods as installMethods, signedMethods as installSignedMethods } from "../installs/methods.js";
import type { Services } from "../platform.js";

const LOG_LEVELS = { debug: "Debug", info: "Info", warn: "Warn", error: "Error" } as const;

const methods: MethodHandlers<typeof PlatformMethods, CallbackClaims, PlatformError, Services> = {
  ...connectionMethods,
  ...installMethods,

  log: ({ level, message, data }, { auth: claims }) =>
    Effect.logWithLevel(LOG_LEVELS[level])(message, ...(data ? [data] : [])).pipe(
      Effect.annotateLogs({ source: "app", installId: claims.installId, ...(claims.callId && { callId: claims.callId }) }),
      Effect.as({}),
    ),
};

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

const signedMethods: MethodHandlers<typeof SignedPlatformMethods, Install, PlatformError, Services> = {
  ...appSignedMethods,
  ...installSignedMethods,
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
