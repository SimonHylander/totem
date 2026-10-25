import { describe, expect, it } from "vitest";
import { createHandler, defineApp, type Manifest } from "@totem/sdk";
import { createPlatform } from "./http.js";

const PLATFORM = "http://platform.test";
const APP = "http://app.test/";

const manifest = {
  name: "mailer",
  version: "0.1.0",
  protocol: "1",
  provides: {
    actions: {
      send: {
        input: { type: "object" },
        output: {
          type: "object",
          required: ["key", "sent"],
          properties: { key: { type: "string" }, sent: { type: "number" } },
        },
      },
    },
  },
  needs: { credentials: { mail: { type: "apiKey" } }, state: true },
} as const satisfies Manifest;

const mailer = defineApp(manifest, {
  actions: {
    send: async (_input, ctx) => {
      const { key } = await ctx.credentials.get("mail");
      const sent = ((await ctx.state.get<number>("sent")) ?? 0) + 1;
      await ctx.state.set("sent", sent);
      return { key, sent };
    },
  },
});

const principals = [
  { token: "op", principal: { id: "simon", role: { name: "operator" } } },
  { token: "acme", principal: { id: "alice", role: { name: "tenantAdmin", tenantId: "acme" } } },
  { token: "globex", principal: { id: "bob", role: { name: "tenantAdmin", tenantId: "globex" } } },
] as const;

/**
 * Wire a platform and an app together in memory. Requests to PLATFORM reach the platform and
 * requests to APP reach the app, which only exists once registration has issued its secret.
 */
function setup(app: ReturnType<typeof defineApp> = mailer) {
  let appHandler: ((request: Request) => Promise<Response>) | null = null;
  const network: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    if (request.url.startsWith(PLATFORM)) return platform.handle(request);
    if (request.url === APP && appHandler) return appHandler(request);
    throw new Error(`unreachable: ${request.url}`);
  };
  const platform = createPlatform({ baseUrl: PLATFORM, principals: [...principals], fetch: network });

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

  const register = async () => {
    const { body } = await api("op", "POST", "/api/apps", { url: APP });
    appHandler = createHandler(app, { secret: body["secret"] as string, fetch: network });
    return body["appId"] as string;
  };

  return { api, register, network };
}

async function installed() {
  const env = setup();
  const appId = await env.register();
  await env.api("op", "POST", `/api/apps/${appId}/initialize`);
  const { body } = await env.api("acme", "POST", "/api/tenants/acme/installs", { appId });
  return { ...env, appId, installId: body["installId"] as string };
}

describe("platform", () => {
  it("registers, installs, connects and invokes, with install-scoped state", async () => {
    const { api, installId } = await installed();

    expect(await api("acme", "PUT", `/api/installs/${installId}/connections/mail/api-key`, { key: "k1" })).toEqual({
      status: 200,
      body: {},
    });
    const first = await api("acme", "POST", `/api/installs/${installId}/actions/send`, { input: {} });
    const second = await api("acme", "POST", `/api/installs/${installId}/actions/send`, { input: {} });

    expect(first).toEqual({ status: 200, body: { output: { key: "k1", sent: 1 } } });
    expect(second.body).toEqual({ output: { key: "k1", sent: 2 } });
  });

  it("keeps tenants apart", async () => {
    const { api, appId, installId } = await installed();

    expect((await api("globex", "PUT", `/api/installs/${installId}/connections/mail/api-key`, { key: "x" })).status).toBe(403);
    expect((await api("globex", "POST", `/api/installs/${installId}/actions/send`, { input: {} })).status).toBe(403);
    expect((await api("globex", "POST", "/api/tenants/acme/installs", { appId })).status).toBe(403);
    expect((await api("acme", "POST", "/api/apps", { url: APP })).status).toBe(403);
  });

  it("rejects an install config that is not an object", async () => {
    const env = setup();
    const appId = await env.register();
    await env.api("op", "POST", `/api/apps/${appId}/initialize`);
    expect((await env.api("acme", "POST", "/api/tenants/acme/installs", { appId, config: "x" })).status).toBe(400);
  });

  it("rejects unknown management tokens and callback tokens", async () => {
    const { api, network } = setup();

    expect((await api("nope", "POST", "/api/apps", { url: APP })).status).toBe(401);
    const forged = await network(`${PLATFORM}/rpc`, {
      method: "POST",
      headers: { authorization: "Bearer forged.token" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "credentials/get", params: { name: "mail" } }),
    });
    expect(forged.status).toBe(401);
  });

  it("returns CredentialMissing when the tenant has not connected", async () => {
    const { api, installId } = await installed();
    const { status, body } = await api("acme", "POST", `/api/installs/${installId}/actions/send`, { input: {} });
    expect(status).toBe(422);
    expect(body).toMatchObject({ error: { code: -32002 } });
  });

  it("refuses a manifest whose OAuth endpoints are not https", async () => {
    const evil = defineApp(
      {
        ...manifest,
        needs: {
          credentials: {
            crm: {
              type: "oauth2",
              authorizeUrl: "https://crm.test/authorize",
              tokenUrl: "http://localhost:80@evil.test/token",
              scopes: [],
            },
          },
        },
      } as const satisfies Manifest,
      { actions: { send: async () => ({ key: "", sent: 0 }) } },
    );
    const { api, register } = setup(evil);
    const appId = await register();

    const { status } = await api("op", "POST", `/api/apps/${appId}/initialize`);
    expect(status).toBe(422);
  });
});
