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
import { HttpError, bearerToken } from "./access.js";
import { forwardPortCall, getInstall, manifestOf, runAction } from "./apps.js";
import { verifyCallbackToken, type CallbackClaims } from "./callback-token.js";
import { bindPort, connectPort, listApps, listPorts, unbindPort } from "./catalog.js";
import { getCredential } from "./connections.js";
import type { Context, Install } from "./store.js";

// The endpoint apps call (ADR 0008). The callback token names the install, so params carry no tenant.
// Signed methods are the exception: the app signs them with its HMAC secret and names one of its
// installs (ADR 0014, ADR 0015).

type Methods = {
  [K in keyof PlatformMethods]: (
    ctx: Context,
    claims: CallbackClaims,
    params: PlatformMethods[K]["params"],
  ) => Promise<PlatformMethods[K]["result"]>;
};

const methods: Methods = {
  "credentials/get": (ctx, claims, { name }) => getCredential(ctx, claims, name),

  async "state/get"(ctx, claims, { key }) {
    return { value: stateOf(ctx, claims).get(key) ?? null };
  },

  async "state/set"(ctx, claims, { key, value }) {
    const state = stateOf(ctx, claims);
    if (value === null) state.delete(key);
    else state.set(key, value);
    return {};
  },

  async log(_ctx, claims, { level, message, data }) {
    console[level](`[${claims.installId}${claims.callId ? ` ${claims.callId}` : ""}] ${message}`, data ?? "");
    return {};
  },

  async "actions/invoke"(ctx, claims, { port, input }) {
    return { output: await forwardPortCall(ctx, claims, port, input) };
  },
};

function stateOf(ctx: Context, claims: CallbackClaims) {
  const install = getInstall(ctx, claims.installId);
  if (manifestOf(ctx, install).needs.state !== true) {
    throw new RpcError(ErrorCode.NotDeclared, "state is not declared in the manifest");
  }
  return install.state;
}

const isMethod = (name: string): name is keyof PlatformMethods => name in methods;

/** Handle one JSON-RPC request from an app. */
export async function handlePlatformMethod(ctx: Context, request: Request): Promise<Response> {
  const body = await request.text();
  const signature = request.headers.get(SIGNATURE_HEADER);
  if (signature !== null) return handleSigned(ctx, signature, body);

  const claims = verifyCallbackToken(ctx.store.callbackKey, bearerToken(request));
  if (!claims || !ctx.store.installs.has(claims.installId)) {
    return reply(null, new RpcError(ErrorCode.Unauthorized, "bad or expired callback token"), 401);
  }
  const parsed = parse(body);
  if (parsed instanceof Response) return parsed;
  if (!isMethod(parsed.method)) {
    return reply(parsed.id, new RpcError(ErrorCode.MethodNotFound, `unknown method "${parsed.method}"`));
  }
  const method = methods[parsed.method] as (ctx: Context, claims: CallbackClaims, params: unknown) => Promise<unknown>;
  return run(parsed, () => method(ctx, claims, parsed.params));
}

type Params = Record<string, unknown>;

/**
 * Methods the app signs with its HMAC secret (ADR 0014, ADR 0015). The install is verified before
 * the method runs, and each method checks its own remaining params.
 */
type SignedMethods = {
  [K in keyof SignedPlatformMethods]: (
    ctx: Context,
    install: Install,
    params: Params,
  ) => Promise<SignedPlatformMethods[K]["result"]>;
};

const signedMethods: SignedMethods = {
  async "actions/start"(ctx, install, params) {
    if (!("input" in params)) throw new RpcError(ErrorCode.InvalidParams, "input is required");
    return { output: await runAction(ctx, install, string(params, "action"), params["input"], 0) };
  },

  async "apps/list"(ctx, install) {
    return { apps: listApps(ctx, install) };
  },

  async "ports/list"(ctx, install) {
    return { ports: listPorts(ctx, install) };
  },

  async "ports/bind"(ctx, install, params) {
    await bindPort(ctx, install, string(params, "port"), string(params, "appId"), string(params, "action"));
    return {};
  },

  async "ports/unbind"(ctx, install, params) {
    unbindPort(ctx, install, string(params, "port"));
    return {};
  },

  async "ports/connect"(ctx, install, params) {
    const port = string(params, "port");
    return { url: connectPort(ctx, install, port, string(params, "credential"), string(params, "returnTo")) };
  },
};

const isSignedMethod = (name: string): name is keyof SignedPlatformMethods => name in signedMethods;

/**
 * A request signed by the app. An unknown install, an install of another app and a bad signature
 * all answer Unauthorized, so signed methods do not reveal which installs exist.
 */
async function handleSigned(ctx: Context, signature: string, body: string): Promise<Response> {
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

  const install = ctx.store.installs.get(installId);
  const app = install && ctx.store.apps.get(install.appId);
  if (!install || !app || !(await verify(app.secret.reveal(), signature, body))) {
    return reply(parsed.id, new RpcError(ErrorCode.Unauthorized, "bad signature"), 401);
  }
  const method = signedMethods[parsed.method];
  return run(parsed, () => method(ctx, install, params));
}

function isObject(value: unknown): value is Params {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A required non-empty string param. */
function string(params: Params, field: string): string {
  const value = params[field];
  if (typeof value !== "string" || value === "") throw new RpcError(ErrorCode.InvalidParams, `${field} is required`);
  return value;
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

/** Run a method and wrap its result or error in a JSON-RPC response. */
async function run(request: JsonRpcRequest, method: () => Promise<unknown>): Promise<Response> {
  try {
    return reply(request.id, { result: await method() });
  } catch (error) {
    if (error instanceof RpcError) return reply(request.id, error);
    // A management check that a signed method reuses, such as a missing OAuth client.
    if (error instanceof HttpError) return reply(request.id, new RpcError(ErrorCode.InvalidParams, error.message));
    console.error(`[totem] ${request.method} failed`, error);
    return reply(request.id, new RpcError(ErrorCode.InternalError, "internal error"));
  }
}

function reply(id: JsonRpcId, outcome: RpcError | { result: unknown }, status = 200): Response {
  const body: JsonRpcResponse =
    outcome instanceof RpcError ? { jsonrpc: "2.0", id, error: outcome.toJSON() } : { jsonrpc: "2.0", id, ...outcome };
  return Response.json(body, { status });
}
