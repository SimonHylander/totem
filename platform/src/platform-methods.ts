import {
  ErrorCode,
  RpcError,
  isJsonRpcRequest,
  type JsonRpcId,
  type JsonRpcResponse,
  type PlatformMethods,
} from "@totem/protocol";
import { bearerToken } from "./access.js";
import { forwardPortCall, getInstall, manifestOf } from "./apps.js";
import { verifyCallbackToken, type CallbackClaims } from "./callback-token.js";
import { getCredential } from "./connections.js";
import type { Context } from "./store.js";

// The endpoint apps call (ADR 0008). The callback token names the install, so params carry no tenant.

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
  const claims = verifyCallbackToken(ctx.store.callbackKey, bearerToken(request));
  if (!claims || !ctx.store.installs.has(claims.installId)) {
    return reply(null, new RpcError(ErrorCode.Unauthorized, "bad or expired callback token"), 401);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(await request.text());
  } catch {
    return reply(null, new RpcError(ErrorCode.ParseError, "invalid JSON"));
  }
  if (!isJsonRpcRequest(parsed)) return reply(null, new RpcError(ErrorCode.InvalidRequest, "not a JSON-RPC 2.0 request"));
  if (!isMethod(parsed.method)) {
    return reply(parsed.id, new RpcError(ErrorCode.MethodNotFound, `unknown method "${parsed.method}"`));
  }

  try {
    const method = methods[parsed.method] as (ctx: Context, claims: CallbackClaims, params: unknown) => Promise<unknown>;
    return reply(parsed.id, { result: await method(ctx, claims, parsed.params) });
  } catch (error) {
    if (error instanceof RpcError) return reply(parsed.id, error);
    console.error(`[totem] ${parsed.method} failed`, error);
    return reply(parsed.id, new RpcError(ErrorCode.InternalError, "internal error"));
  }
}

function reply(id: JsonRpcId, outcome: RpcError | { result: unknown }, status = 200): Response {
  const body: JsonRpcResponse =
    outcome instanceof RpcError ? { jsonrpc: "2.0", id, error: outcome.toJSON() } : { jsonrpc: "2.0", id, ...outcome };
  return Response.json(body, { status });
}
