import {
  ErrorCode,
  PROTOCOL_VERSION,
  RpcError,
  SIGNATURE_HEADER,
  isJsonRpcRequest,
  verify,
  type AppMethods,
  type JsonRpcId,
  type JsonRpcResponse,
  type Manifest,
} from "@totem/protocol";
import type { AnyApp, App } from "./define-app.js";
import { platformClient } from "./platform.js";

type HandlerOptions = {
  /** Shared secret issued by the platform at registration. Verifies every request. */
  secret: string;
  /** Known before `initialize` runs, for apps restarted after registration. */
  platformUrl?: string;
  fetch?: typeof fetch;
};

/**
 * The driving adapter. Turns a signed JSON-RPC request into handler calls
 * and a JSON-RPC response. Framework free: `Request` in, `Response` out.
 */
export function createHandler<M extends Manifest>(typedApp: App<M>, options: HandlerOptions) {
  const app = typedApp as unknown as AnyApp;
  let platformUrl = options.platformUrl;

  const platformFor = (token: string) => {
    if (!platformUrl) {
      throw new RpcError(ErrorCode.InvalidRequest, "platformUrl unknown; call initialize first");
    }
    return platformClient({ url: platformUrl, token, ...(options.fetch && { fetch: options.fetch }) });
  };

  const methods: { [K in keyof AppMethods]: (params: AppMethods[K]["params"]) => Promise<AppMethods[K]["result"]> } = {
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

    async install({ context, callbackToken }) {
      if (!app.handlers.install) throw new RpcError(ErrorCode.MethodNotFound, "install not implemented");
      await app.install({ platform: platformFor(callbackToken), context });
      return {};
    },

    async uninstall({ context, callbackToken }) {
      if (!app.handlers.uninstall) throw new RpcError(ErrorCode.MethodNotFound, "uninstall not implemented");
      await app.uninstall({ platform: platformFor(callbackToken), context });
      return {};
    },

    async "actions/invoke"({ action, input, context, callbackToken }) {
      if (!(action in app.handlers.actions)) {
        throw new RpcError(ErrorCode.ActionNotFound, `unknown action "${action}"`);
      }
      const output = await app.invoke(action, input, { platform: platformFor(callbackToken), context });
      return { output };
    },
  };

  const isMethod = (name: string): name is keyof AppMethods => name in methods;

  return async (request: Request): Promise<Response> => {
    if (request.method !== "POST") return new Response(null, { status: 405 });

    const body = await request.text();
    if (!(await verify(options.secret, request.headers.get(SIGNATURE_HEADER), body))) {
      return reply(null, failure(new RpcError(ErrorCode.Unauthorized, "bad signature")), 401);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      return reply(null, failure(new RpcError(ErrorCode.ParseError, "invalid JSON")));
    }
    if (!isJsonRpcRequest(parsed)) {
      return reply(null, failure(new RpcError(ErrorCode.InvalidRequest, "not a JSON-RPC 2.0 request")));
    }
    if (!isMethod(parsed.method)) {
      return reply(parsed.id, failure(new RpcError(ErrorCode.MethodNotFound, `unknown method "${parsed.method}"`)));
    }

    try {
      const result = await methods[parsed.method](parsed.params as never);
      return reply(parsed.id, { result });
    } catch (error) {
      if (error instanceof RpcError) return reply(parsed.id, failure(error));
      console.error(`[totem] ${parsed.method} failed`, error);
      return reply(parsed.id, failure(new RpcError(ErrorCode.InternalError, "internal error")));
    }
  };
}

function failure(error: RpcError) {
  return { error: error.toJSON() };
}

function reply(id: JsonRpcId, body: { result: unknown } | { error: RpcError["toJSON"] extends () => infer R ? R : never }, status = 200) {
  const response: JsonRpcResponse = { jsonrpc: "2.0", id, ...body };
  return new Response(JSON.stringify(response), { status, headers: { "content-type": "application/json" } });
}
