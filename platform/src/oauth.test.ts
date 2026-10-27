import { afterEach, describe, expect, it, vi } from "vitest";
import { ErrorCode } from "@totem/protocol";
import { appClient, defineApp, type Manifest } from "@totem/sdk";
import { Store } from "./store.js";
import { PLATFORM, testPlatform } from "./test-network.js";

// The platform runs generic OAuth 2.0 (ADR 0012), so these tests use a made-up provider. The app
// declares the provider's endpoints and calls its API with whatever token the platform hands over.

const manifest = {
  name: "crm",
  version: "0.1.0",
  protocol: "1",
  provides: {
    actions: {
      whoami: {
        input: { type: "object" },
        output: { type: "object", required: ["account"], properties: { account: { type: "string" } } },
      },
    },
  },
  needs: {
    credentials: {
      crm: {
        type: "oauth2",
        authorizeUrl: "https://crm.test/oauth/authorize",
        tokenUrl: "https://crm.test/oauth/token",
        scopes: ["contacts.read", "contacts.write"],
      },
    },
  },
} as const satisfies Manifest;

const crmApp = defineApp(manifest, {
  actions: {
    whoami: async (_input, ctx) => {
      const { accessToken } = await ctx.credentials.get("crm");
      const response = await fetch("https://crm.test/api/me", { headers: { authorization: `Bearer ${accessToken}` } });
      if (!response.ok) throw new Error(`crm returned ${response.status}`);
      return (await response.json()) as { account: string };
    },
  },
});

/**
 * In-memory provider: the OAuth token endpoint and one API route. `expiresIn` controls how soon
 * tokens go stale. `holdRefresh` pauses refresh requests until the returned function releases them.
 */
function fakeProvider({ expiresIn = 1800 } = {}) {
  const codes = new Set<string>();
  const accessTokens = new Set<string>();
  const refreshTokens = new Set<string>();
  const tokenRequests: Record<string, string>[] = [];
  /** The traceparent header of each token request. */
  const traceHeaders: (string | null)[] = [];
  let issued = 0;
  let hold: Promise<void> | null = null;

  const issue = () => {
    issued += 1;
    accessTokens.add(`at${issued}`);
    refreshTokens.add(`rt${issued}`);
    return Response.json({ access_token: `at${issued}`, refresh_token: `rt${issued}`, expires_in: expiresIn });
  };

  const handle = async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    if (request.url === "https://crm.test/oauth/token") {
      const form = Object.fromEntries(new URLSearchParams(await request.text()));
      tokenRequests.push(form);
      traceHeaders.push(request.headers.get("traceparent"));
      if (form["grant_type"] === "authorization_code") {
        if (!codes.delete(form["code"]!)) return Response.json({ error: "invalid_grant" }, { status: 400 });
        return issue();
      }
      if (hold) await hold;
      if (!refreshTokens.has(form["refresh_token"]!)) return Response.json({ error: "invalid_grant" }, { status: 400 });
      return issue();
    }
    if (url.pathname === "/api/me") {
      const token = request.headers.get("authorization")?.replace("Bearer ", "") ?? "";
      if (!accessTokens.has(token)) return new Response("unauthorized", { status: 401 });
      return Response.json({ account: "acme-crm" });
    }
    throw new Error(`fake provider has no ${request.url}`);
  };

  return {
    tokenRequests,
    traceHeaders,
    /** The provider's consent screen: the user approves and the provider issues a code for the redirect. */
    consent(authorizeUrl: string) {
      const params = new URL(authorizeUrl).searchParams;
      const code = `code${codes.size + issued}`;
      codes.add(code);
      const redirect = new URL(params.get("redirect_uri")!);
      redirect.searchParams.set("code", code);
      redirect.searchParams.set("state", params.get("state")!);
      return redirect.pathname + redirect.search;
    },
    /** Revoke every refresh token, as uninstalling the provider app does. */
    revoke: () => refreshTokens.clear(),
    holdRefresh() {
      let release!: () => void;
      hold = new Promise((resolve) => (release = resolve));
      return () => {
        hold = null;
        release();
      };
    },
    external: (request: Request) => (request.url.startsWith("https://crm.test/") ? handle(request) : null),
  };
}

const client = { clientId: "crm-client", clientSecret: "crm-secret" };

async function setup(options?: { expiresIn?: number }) {
  const provider = fakeProvider(options);
  const env = testPlatform(crmApp, provider.external);
  // The app calls the provider with the global fetch.
  vi.stubGlobal("fetch", env.network);
  const { appId, installId } = await env.install();
  const { body: oauthClient } = await env.api("op", "PUT", `/api/apps/${appId}/oauth-clients/crm`, client);
  const alice = await env.browser("acme");

  /** Alice connects through the browser. Returns the callback response. */
  const connect = async () => {
    const authorizeUrl = (await alice.connect(installId, "crm")).headers.get("location")!;
    return alice.get(provider.consent(authorizeUrl));
  };
  const whoami = () => env.api("acme", "POST", `/api/installs/${installId}/actions/whoami`, { input: {} });

  return { ...env, provider, appId, installId, oauthClient, alice, connect, whoami };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OAuth connect", () => {
  it("connects through consent and hands the access token to the app", async () => {
    const { oauthClient, alice, installId, provider, whoami } = await setup();

    const bindingId = String(oauthClient["redirectUri"]).split("/").at(-1);
    expect(oauthClient).toEqual({
      redirectUri: `${PLATFORM}/oauth/callback/${bindingId}`,
      authorizeUrl: "https://crm.test/oauth/authorize",
      tokenUrl: "https://crm.test/oauth/token",
      scopes: ["contacts.read", "contacts.write"],
    });

    const started = await alice.connect(installId, "crm");
    const location = started.headers.get("location")!;
    expect(location).toContain("scope=contacts.read%20contacts.write");
    const authorizeUrl = new URL(location);
    expect(authorizeUrl.origin + authorizeUrl.pathname).toBe("https://crm.test/oauth/authorize");
    expect(Object.fromEntries(authorizeUrl.searchParams)).toMatchObject({
      response_type: "code",
      client_id: "crm-client",
      redirect_uri: oauthClient["redirectUri"],
      scope: "contacts.read contacts.write",
    });

    const callback = await alice.get(provider.consent(authorizeUrl.toString()));
    expect(callback.status).toBe(200);
    expect(provider.tokenRequests).toEqual([
      {
        grant_type: "authorization_code",
        code: expect.any(String),
        redirect_uri: oauthClient["redirectUri"],
        client_id: "crm-client",
        client_secret: "crm-secret",
      },
    ]);

    expect(await whoami()).toEqual({ status: 200, body: { output: { account: "acme-crm" } } });
  });

  it("sends no trace context to the provider", async () => {
    const { provider, connect } = await setup();
    expect((await connect()).status).toBe(200);
    expect(provider.traceHeaders).toEqual([null]);
  });

  it("refuses a callback from a browser that did not start the connect", async () => {
    const { browser, installId, alice, provider, whoami } = await setup();
    const authorizeUrl = (await alice.connect(installId, "crm")).headers.get("location")!;
    const callbackPath = provider.consent(authorizeUrl);

    const otherAliceTab = await browser("acme");
    expect((await otherAliceTab.get(callbackPath)).status).toBe(403);
    expect((await alice.get(callbackPath)).status).toBe(400);
    expect((await whoami()).body).toMatchObject({ error: { code: -32002 } });
  });

  it("refuses a connect form without the session's form token", async () => {
    const { platform, alice, installId } = await setup();
    const signedIn = await alice.get(`/installs/${installId}/connect/crm`);
    expect(signedIn.status).toBe(200);

    const forged = await platform.handle(
      new Request(`${PLATFORM}/installs/${installId}/connect/crm`, {
        method: "POST",
        headers: { cookie: alice.cookie },
        body: new URLSearchParams({ csrf: "guess" }),
      }),
    );
    expect(forged.status).toBe(403);
  });

  it("refuses cross-site sign-in and off-site redirects", async () => {
    const { platform } = await setup();
    const signIn = (next: string, origin?: string) =>
      platform.handle(
        new Request(`${PLATFORM}/signin`, {
          method: "POST",
          headers: origin ? { origin } : {},
          body: new URLSearchParams({ token: "acme", next }),
        }),
      );

    expect((await signIn("/", "https://evil.test")).status).toBe(403);
    expect((await signIn("/installs", PLATFORM)).headers.get("location")).toBe("/installs");
    expect((await signIn("//evil.test")).headers.get("location")).toBe("/");
    expect((await signIn("/\\evil.test")).headers.get("location")).toBe("/");
  });

  it("refuses a code that arrives on another binding's callback, and a replayed state", async () => {
    const { installId, alice, provider, connect } = await setup();
    const authorizeUrl = (await alice.connect(installId, "crm")).headers.get("location")!;
    const callbackPath = provider.consent(authorizeUrl);
    const wrongBinding = callbackPath.replace(/callback\/[^?]+/, "callback/other");

    expect((await alice.get(wrongBinding)).status).toBe(400);
    expect((await alice.get(callbackPath)).status).toBe(400);

    const connected = await connect();
    expect(connected.status).toBe(200);
  });
});

describe("expiry", () => {
  it("ends a browser session after 12 hours", async () => {
    const { alice, installId, advance } = await setup();
    const page = `/installs/${installId}/connect/crm`;
    expect((await alice.get(page)).status).toBe(200);

    await advance("12 hours");
    const expired = await alice.get(page);
    expect(expired.status).toBe(303);
    expect(expired.headers.get("location")).toBe(`/signin?next=${encodeURIComponent(page)}`);
  });

  it("refuses a callback for a connect started more than 10 minutes ago", async () => {
    const { installId, alice, provider, advance } = await setup();
    const callbackPath = provider.consent((await alice.connect(installId, "crm")).headers.get("location")!);

    await advance("10 minutes");
    expect((await alice.get(callbackPath)).status).toBe(400);
    expect(provider.tokenRequests).toEqual([]);
  });
});

/** A consumer whose `whoami` port reaches the CRM app, as the events app reaches HubSpot. */
const consumer = defineApp(
  {
    name: "consumer",
    version: "0.1.0",
    protocol: "1",
    provides: { actions: { who: manifest.provides.actions.whoami } },
    needs: { actions: { whoami: manifest.provides.actions.whoami } },
  } as const satisfies Manifest,
  { actions: { who: async (input, ctx) => ctx.ports.whoami(input) } },
);

describe("ports/connect", () => {
  async function connectSetup() {
    const env = await setup();
    await env.api("op", "PUT", `/api/apps/${env.appId}/visibility`, { visibility: "public" });
    const own = await env.install({ other: consumer });
    const client = appClient(consumer, { secret: env.secrets.get(own.appId)!, platformUrl: `${PLATFORM}/rpc`, fetch: env.network });
    await client.bind(own.installId, "whoami", { appId: env.appId, action: "whoami" });
    const app = await env.platform.runtime.runPromise(Store.use(({ apps }) => apps.get(own.appId)));
    const origin = new URL(app.url).origin;
    return { ...env, own, client, origin };
  }

  it("connects the bound provider without a platform session and returns to the app", async () => {
    const { client, own, origin, provider, platform } = await connectSetup();
    expect((await client.ports(own.installId)).whoami?.credentials).toEqual({ crm: { type: "oauth2", connected: false } });

    const url = await client.connect(own.installId, "whoami", "crm", `${origin}/integrations`);
    const callback = await platform.handle(new Request(PLATFORM + provider.consent(url)));

    expect(callback.headers.get("location")).toBe(`${origin}/integrations`);
    expect((await client.ports(own.installId)).whoami?.credentials).toEqual({ crm: { type: "oauth2", connected: true } });
    expect(await client.start(own.installId, "who", {})).toEqual({ account: "acme-crm" });
  });

  it("refuses a returnTo off the app's origin", async () => {
    const { client, own } = await connectSetup();
    await expect(client.connect(own.installId, "whoami", "crm", "https://evil.test/")).rejects.toMatchObject({
      code: ErrorCode.InvalidParams,
    });
  });
});

describe("refresh", () => {
  it("refreshes stale tokens once for concurrent calls", async () => {
    const { connect, whoami, provider } = await setup({ expiresIn: 60 });
    await connect();
    const release = provider.holdRefresh();

    const calls = Promise.all([whoami(), whoami()]);
    await vi.waitFor(() => expect(provider.tokenRequests).toHaveLength(2));
    // In memory, both calls reach credentials/get within a few milliseconds.
    await new Promise((resolve) => setTimeout(resolve, 20));
    release();
    const results = await calls;

    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expect(provider.tokenRequests.map((r) => `${r["grant_type"]} ${r["refresh_token"] ?? ""}`)).toEqual([
      "authorization_code ",
      "refresh_token rt1",
    ]);
  });

  it("drops the connection when the grant is revoked", async () => {
    const { connect, whoami, provider } = await setup({ expiresIn: 60 });
    await connect();
    provider.revoke();

    expect((await whoami()).body).toMatchObject({ error: { code: -32002 } });
    expect((await whoami()).body).toMatchObject({ error: { code: -32002 } });
    expect(provider.tokenRequests).toHaveLength(2);
  });

  it("keeps a reconnect that lands while a failing refresh is in flight", async () => {
    const { connect, whoami, provider } = await setup({ expiresIn: 60 });
    await connect();
    provider.revoke();
    const release = provider.holdRefresh();

    const pending = whoami();
    await vi.waitFor(() => expect(provider.tokenRequests).toHaveLength(2));
    expect((await connect()).status).toBe(200);
    release();

    expect((await pending).status).toBe(200);

    expect((await whoami()).status).toBe(200);
  });
});

describe("OAuth client changes", () => {
  it("keeps connections when the secret rotates, and drops them when the client changes", async () => {
    const { api, appId, connect, whoami, provider } = await setup({ expiresIn: 60 });
    await connect();

    await api("op", "PUT", `/api/apps/${appId}/oauth-clients/crm`, { ...client, clientSecret: "rotated" });
    expect((await whoami()).status).toBe(200);
    expect(provider.tokenRequests.at(-1)).toMatchObject({ grant_type: "refresh_token", client_secret: "rotated" });

    const requestsBefore = provider.tokenRequests.length;
    await api("op", "PUT", `/api/apps/${appId}/oauth-clients/crm`, { clientId: "other-client", clientSecret: "s" });
    expect((await whoami()).body).toMatchObject({ error: { code: -32002 } });
    expect(provider.tokenRequests).toHaveLength(requestsBefore);
  });

  it("does not revive old grants when the original client is set again", async () => {
    const { api, appId, connect, whoami } = await setup();
    await connect();

    await api("op", "PUT", `/api/apps/${appId}/oauth-clients/crm`, { clientId: "other-client", clientSecret: "s" });
    await api("op", "PUT", `/api/apps/${appId}/oauth-clients/crm`, client);

    expect((await whoami()).body).toMatchObject({ error: { code: -32002 } });
  });

  it("lets only operators set OAuth clients", async () => {
    const { api, appId } = await setup();
    expect((await api("acme", "PUT", `/api/apps/${appId}/oauth-clients/crm`, client)).status).toBe(403);
  });
});
