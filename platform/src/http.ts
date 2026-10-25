import { RpcError } from "@totem/protocol";
import { HttpError, authenticate, bearerToken, hashToken, type Principal } from "./access.js";
import {
  PLATFORM_METHODS_PATH,
  createInstall,
  initializeApp,
  invokeAction,
  registerApp,
  setBinding,
  setVisibility,
} from "./apps.js";
import { handleBrowser } from "./browser.js";
import { connectApiKey, setOAuthClient } from "./connections.js";
import { handlePlatformMethod } from "./platform-methods.js";
import { createStore, type Context, type PortBinding, type Visibility } from "./store.js";

// The HTTP shell. Routes parse the request and call one operation. Operations authorize themselves.

type PlatformOptions = {
  /** The platform's public origin, such as `http://localhost:3000`. */
  baseUrl: string;
  /** Management tokens and who holds them. */
  principals: { token: string; principal: Principal }[];
  allowLocalhost?: boolean;
  fetch?: typeof fetch;
};

type Params = Record<string, string>;
type Route = {
  method: string;
  pattern: RegExp;
  run: (ctx: Context, principal: Principal, params: Params, body: Record<string, unknown>) => Promise<unknown> | unknown;
};

const routes: Route[] = [
  {
    method: "POST",
    pattern: /^\/api\/apps$/,
    run: (ctx, principal, _params, body) => registerApp(ctx, principal, string(body, "url")),
  },
  {
    method: "POST",
    pattern: /^\/api\/apps\/(?<appId>[^/]+)\/initialize$/,
    run: async (ctx, principal, { appId }) => ({ manifest: await initializeApp(ctx, principal, appId!) }),
  },
  {
    method: "PUT",
    pattern: /^\/api\/apps\/(?<appId>[^/]+)\/visibility$/,
    run: (ctx, principal, { appId }, body) => {
      setVisibility(ctx, principal, appId!, visibility(body["visibility"]));
      return {};
    },
  },
  {
    method: "PUT",
    pattern: /^\/api\/apps\/(?<appId>[^/]+)\/oauth-clients\/(?<name>[^/]+)$/,
    run: (ctx, principal, { appId, name }, body) =>
      setOAuthClient(ctx, principal, appId!, name!, {
        clientId: string(body, "clientId"),
        clientSecret: string(body, "clientSecret"),
      }),
  },
  {
    method: "POST",
    pattern: /^\/api\/tenants\/(?<tenantId>[^/]+)\/installs$/,
    run: async (ctx, principal, { tenantId }, body) => {
      const bindings = Object.fromEntries(
        Object.entries(object(body, "bindings")).map(([port, value]) => [port, portBinding(value, `bindings.${port}`)]),
      );
      const install = await createInstall(ctx, principal, tenantId!, string(body, "appId"), object(body, "config"), bindings);
      return { installId: install.id };
    },
  },
  {
    method: "PUT",
    pattern: /^\/api\/installs\/(?<installId>[^/]+)\/bindings\/(?<port>[^/]+)$/,
    run: (ctx, principal, { installId, port }, body) => {
      setBinding(ctx, principal, installId!, port!, portBinding(body, "body"));
      return {};
    },
  },
  {
    method: "PUT",
    pattern: /^\/api\/installs\/(?<installId>[^/]+)\/connections\/(?<name>[^/]+)\/api-key$/,
    run: (ctx, principal, { installId, name }, body) => {
      connectApiKey(ctx, principal, installId!, name!, string(body, "key"));
      return {};
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/installs\/(?<installId>[^/]+)\/actions\/(?<action>[^/]+)$/,
    run: async (ctx, principal, { installId, action }, body) => ({
      output: await invokeAction(ctx, principal, installId!, action!, body["input"] ?? {}),
    }),
  },
];

/** Build the platform. `handle` serves the management API, the browser pages and the platform-methods endpoint. */
export function createPlatform({ baseUrl, principals, allowLocalhost = false, fetch: doFetch = fetch }: PlatformOptions) {
  const store = createStore(new Map(principals.map(({ token, principal }) => [hashToken(token), principal])));
  const ctx: Context = { store, baseUrl, allowLocalhost, fetch: doFetch };

  async function handle(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (request.method === "POST" && pathname === PLATFORM_METHODS_PATH) return handlePlatformMethod(ctx, request);
    if (!pathname.startsWith("/api/")) return handleBrowser(ctx, request);

    for (const route of routes) {
      const match = route.method === request.method ? route.pattern.exec(pathname) : null;
      if (!match) continue;
      try {
        const principal = authenticate(store, bearerToken(request));
        if (!principal) throw new HttpError(401, "missing or unknown management token");
        const body = request.method === "GET" ? {} : await readJson(request);
        return Response.json(await route.run(ctx, principal, match.groups ?? {}, body));
      } catch (error) {
        return errorResponse(error);
      }
    }
    return Response.json({ error: `no route for ${request.method} ${pathname}` }, { status: 404 });
  }

  return { handle, ctx };
}

function errorResponse(error: unknown): Response {
  if (error instanceof HttpError) return Response.json({ error: error.message }, { status: error.status });
  // A JSON-RPC error from an app: a failed action or a protocol error. The body keeps its code and data.
  if (error instanceof RpcError) return Response.json({ error: error.toJSON() }, { status: 422 });
  console.error("[totem] request failed", error);
  return Response.json({ error: "internal error" }, { status: 500 });
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (text === "") return {};
  try {
    const value: unknown = JSON.parse(text);
    if (isObject(value)) return value;
  } catch {
    // Falls through to the 400 below.
  }
  throw new HttpError(400, "body must be a JSON object");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** An optional JSON object field. Missing means `{}`. */
function object(body: Record<string, unknown>, field: string): Record<string, unknown> {
  const value = body[field] ?? {};
  if (!isObject(value)) throw new HttpError(400, `${field} must be a JSON object`);
  return value;
}

/** `{ installId, action }`, both non-empty strings. */
function portBinding(value: unknown, field: string): PortBinding {
  if (!isObject(value)) throw new HttpError(400, `${field} must be { installId, action }`);
  return { installId: string(value, "installId"), action: string(value, "action") };
}

function visibility(value: unknown): Visibility {
  if (value !== "public" && value !== "internal") throw new HttpError(400, `visibility must be "public" or "internal"`);
  return value;
}

function string(body: Record<string, unknown>, field: string): string {
  const value = body[field];
  if (typeof value !== "string" || value === "") throw new HttpError(400, `${field} is required`);
  return value;
}
