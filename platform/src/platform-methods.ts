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
} from "@totem/protocol";
import { bearerToken } from "./access.js";
import { forwardPortCall, getInstall, manifestOf, runAction } from "./apps.js";
import { verifyCallbackToken, type CallbackClaims } from "./callback-token.js";
import { getCredential } from "./connections.js";
import type { Context } from "./store.js";

// The endpoint apps call (ADR 0008). The callback token names the install, so params carry no tenant.
// `actions/start` is the exception: the app signs it with its HMAC secret instead (ADR 0014).

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

/**
 * `actions/start`, signed by the app (ADR 0014). An unknown install, an install of another app and a
 * bad signature all answer Unauthorized, so the method does not reveal which installs exist.
 */
async function handleSigned(ctx: Context, signature: string, body: string): Promise<Response> {
  const parsed = parse(body);
  if (parsed instanceof Response) return parsed;
  if (parsed.method !== "actions/start") {
    return reply(parsed.id, new RpcError(ErrorCode.MethodNotFound, `"${parsed.method}" needs a callback token`));
  }
  const params = parsed.params as { installId?: unknown; action?: unknown; input?: unknown } | undefined;
  const { installId, action, input } = params ?? {};
  if (typeof installId !== "string" || typeof action !== "string" || !(params && "input" in params)) {
    return reply(parsed.id, new RpcError(ErrorCode.InvalidParams, "installId, action and input are required"));
  }

  const install = ctx.store.installs.get(installId);
  const app = install && ctx.store.apps.get(install.appId);
  if (!install || !app || !(await verify(app.secret.reveal(), signature, body))) {
    return reply(parsed.id, new RpcError(ErrorCode.Unauthorized, "bad signature"), 401);
  }
  return run(parsed, async () => ({ output: await runAction(ctx, install, action, input, 0) }));
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
    console.error(`[totem] ${request.method} failed`, error);
    return reply(request.id, new RpcError(ErrorCode.InternalError, "internal error"));
  }
}

function reply(id: JsonRpcId, outcome: RpcError | { result: unknown }, status = 200): Response {
  const body: JsonRpcResponse =
    outcome instanceof RpcError ? { jsonrpc: "2.0", id, error: outcome.toJSON() } : { jsonrpc: "2.0", id, ...outcome };
  return Response.json(body, { status });
}
