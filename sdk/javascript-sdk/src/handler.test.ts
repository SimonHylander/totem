import { describe, expect, it } from "vitest";
import { ErrorCode, SIGNATURE_HEADER, sign, type JsonRpcResponse, type PlatformMethods } from "@ipaas/protocol";
import { defineApp } from "./define-app.js";
import { fakePlatform, type FakePlatform } from "./fake-platform.js";
import { createHandler } from "./handler.js";
import { AppError } from "./errors.js";

const manifest = {
  name: "echo",
  version: "0.1.0",
  protocol: "1",
  provides: {
    actions: {
      echo: {
        input: { type: "object", required: ["text"], properties: { text: { type: "string" } } },
        output: { type: "object", required: ["text"], properties: { text: { type: "string" } } },
      },
      fail: { input: { type: "object" }, output: { type: "object" } },
    },
  },
  needs: {
    state: true,
    actions: {
      shout: {
        input: { type: "object", required: ["text"], properties: { text: { type: "string" } } },
        output: { type: "object", required: ["text"], properties: { text: { type: "string" } } },
      },
    },
  },
} as const;

const app = defineApp(manifest, {
  actions: {
    echo: async ({ text }, ctx) => {
      await ctx.state.set("last", text);
      return ctx.ports.shout({ text });
    },
    fail: async () => {
      throw new AppError(1001, "nope", { why: "test" });
    },
  },
});

const secret = "app-secret";
const platformUrl = "http://platform.test/rpc";

/** Serve platform methods from a fake, so the handler's real client can be exercised in-process. */
function platformFetch(platform: FakePlatform): typeof fetch {
  return async (_url, init) => {
    const { id, method, params } = JSON.parse(String(init?.body)) as { id: number; method: keyof PlatformMethods; params: never };
    const dispatch: { [K in keyof PlatformMethods]: (p: PlatformMethods[K]["params"]) => Promise<PlatformMethods[K]["result"]> } = {
      "credentials/get": ({ name }) => platform.getCredential(name),
      "state/get": async ({ key }) => ({ value: await platform.getState(key) }),
      "state/set": async ({ key, value }) => ({}) as never,
      log: async ({ level, message, data }) => ({}) as never,
      "actions/invoke": async ({ port, input }) => ({ output: await platform.invokePort(port, input) }),
    };
    if (method === "state/set") await platform.setState(params["key"], params["value"]);
    if (method === "log") await platform.log(params["level"], params["message"], params["data"]);
    const result = await dispatch[method](params);
    return Response.json({ jsonrpc: "2.0", id, result } satisfies JsonRpcResponse);
  };
}

async function call(handle: ReturnType<typeof createHandler>, method: string, params: unknown, options: { sign?: boolean } = {}) {
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (options.sign !== false) headers[SIGNATURE_HEADER] = await sign(secret, body);
  const response = await handle(new Request("http://app.test/", { method: "POST", headers, body }));
  return { status: response.status, body: (await response.json()) as JsonRpcResponse };
}

const context = { tenantId: "t1", installId: "i1", config: {}, callId: "c1" };

describe("createHandler", () => {
  it("rejects unsigned requests", async () => {
    const handle = createHandler(app, { secret });
    const { status, body } = await call(handle, "health", {}, { sign: false });
    expect(status).toBe(401);
    expect(body).toMatchObject({ error: { code: ErrorCode.Unauthorized } });
  });

  it("initialize returns the manifest and checks the protocol major", async () => {
    const handle = createHandler(app, { secret });
    const ok = await call(handle, "initialize", { protocolVersion: "1", platformUrl });
    expect(ok.body).toMatchObject({ result: { manifest: { name: "echo" } } });

    const bad = await call(handle, "initialize", { protocolVersion: "2", platformUrl });
    expect(bad.body).toMatchObject({ error: { code: ErrorCode.ProtocolVersionUnsupported } });
  });

  it("invokes an action with state and ports routed through the platform client", async () => {
    const platform = fakePlatform(app, { ports: { shout: async ({ text }) => ({ text: text.toUpperCase() }) } });
    const handle = createHandler(app, { secret, platformUrl, fetch: platformFetch(platform) });

    const { body } = await call(handle, "actions/invoke", {
      action: "echo",
      input: { text: "hi" },
      context,
      callbackToken: "tok",
    });

    expect(body).toMatchObject({ result: { output: { text: "HI" } } });
    expect(platform.state.get("last")).toBe("hi");
    expect(platform.portCalls).toEqual([{ port: "shout", input: { text: "hi" } }]);
  });

  it("maps AppError to a JSON-RPC error and masks unknown throws", async () => {
    const platform = fakePlatform(app);
    const handle = createHandler(app, { secret, platformUrl, fetch: platformFetch(platform) });

    const failed = await call(handle, "actions/invoke", { action: "fail", input: {}, context, callbackToken: "tok" });
    expect(failed.body).toMatchObject({ error: { code: 1001, message: "nope", data: { why: "test" } } });

    const missing = await call(handle, "actions/invoke", { action: "nope", input: {}, context, callbackToken: "tok" });
    expect(missing.body).toMatchObject({ error: { code: ErrorCode.ActionNotFound } });
  });

  it("answers method-not-found for lifecycle hooks the app did not implement", async () => {
    const handle = createHandler(app, { secret, platformUrl });
    const { body } = await call(handle, "install", { context, callbackToken: "tok" });
    expect(body).toMatchObject({ error: { code: ErrorCode.MethodNotFound } });
  });
});
