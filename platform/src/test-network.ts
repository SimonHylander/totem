import { createHandler, type App, type Manifest } from "@totem/sdk";
import { createPlatform } from "./http.js";

// Test harness: a platform, one app and any external services wired together in memory.

export const PLATFORM = "http://platform.test";
export const APP = "http://app.test/";

export const principals = [
  { token: "op", principal: { id: "simon", role: { name: "operator" } } },
  { token: "acme", principal: { id: "alice", role: { name: "tenantAdmin", tenantId: "acme" } } },
  { token: "globex", principal: { id: "bob", role: { name: "tenantAdmin", tenantId: "globex" } } },
] as const;

type External = (request: Request) => Promise<Response> | null;

/**
 * Requests to PLATFORM reach the platform and requests to an app URL reach that app, which only
 * exists once registration has issued its secret. Anything else goes to `external`, such as a fake
 * provider. `app` is served at APP. `register(other)` serves more apps at their own URLs.
 */
export function testPlatform<M extends Manifest>(app: App<M>, external: External = () => null) {
  const apps = new Map<string, (request: Request) => Promise<Response>>();
  const network: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    if (request.url.startsWith(PLATFORM)) return platform.handle(request);
    const appHandler = apps.get(request.url);
    if (appHandler) return appHandler(request);
    const response = external(request);
    if (!response) throw new Error(`unreachable: ${request.url}`);
    return response;
  };
  const platform = createPlatform({ baseUrl: PLATFORM, principals: [...principals], fetch: network });

  /** Call the management API with a bearer token. */
  const api = async (token: string, method: string, path: string, body?: unknown) => {
    const response = await platform.handle(
      new Request(PLATFORM + path, {
        method,
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        ...(body !== undefined && { body: JSON.stringify(body) }),
      }),
    );
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  };

  const register = async <N extends Manifest>(other?: App<N>) => {
    const url = other ? `http://app${apps.size + 1}.test/` : APP;
    const { body } = await api("op", "POST", "/api/apps", { url });
    const options = { secret: body["secret"] as string, fetch: network };
    apps.set(url, other ? createHandler(other, options) : createHandler(app, options));
    return body["appId"] as string;
  };

  /**
   * Register, initialize and install an app for a tenant. Defaults to `app` and tenant acme.
   * `bindings` go to the install request as they are.
   */
  const install = async <N extends Manifest>(
    { other, tenant = "acme", bindings }: { other?: App<N>; tenant?: "acme" | "globex"; bindings?: unknown } = {},
  ) => {
    const appId = await register(other);
    await api("op", "POST", `/api/apps/${appId}/initialize`);
    const { body } = await api(tenant, "POST", `/api/tenants/${tenant}/installs`, { appId, bindings });
    return { appId, installId: body["installId"] as string };
  };

  /** A browser signed in with a management token. It keeps its session cookie. */
  const browser = async (token: string) => {
    const signedIn = await platform.handle(
      new Request(`${PLATFORM}/signin`, { method: "POST", body: new URLSearchParams({ token, next: "/" }) }),
    );
    const cookie = signedIn.headers.get("set-cookie")!.split(";")[0]!;
    const send = (path: string, init: RequestInit = {}) =>
      platform.handle(new Request(new URL(path, PLATFORM), { ...init, headers: { cookie } }));

    return {
      cookie,
      get: (path: string) => send(path),
      /** Open the connect page and press Connect. Resolves to the redirect. */
      connect: async (installId: string, name: string) => {
        const html = await (await send(`/installs/${installId}/connect/${name}`)).text();
        const csrf = /name="csrf" value="([^"]+)"/.exec(html)![1]!;
        return send(`/installs/${installId}/connect/${name}`, { method: "POST", body: new URLSearchParams({ csrf }) });
      },
    };
  };

  return { platform, network, api, register, install, browser };
}
