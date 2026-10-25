import { describe, expect, it } from "vitest";
import { AppError, defineApp, type Manifest } from "@totem/sdk";
import { testPlatform } from "./test-network.js";

const text = { type: "object", required: ["text"], properties: { text: { type: "string" } } } as const;

/** The provider: shouts text back, or fails with an app error. */
const shouter = defineApp(
  {
    name: "shouter",
    version: "0.1.0",
    protocol: "1",
    provides: { actions: { shout: { input: text, output: text }, boom: { input: text, output: text } } },
    needs: {},
  } as const satisfies Manifest,
  {
    actions: {
      shout: async ({ text }) => ({ text: text.toUpperCase() }),
      boom: async () => {
        throw new AppError(1002, "boom", { why: "test" });
      },
    },
  },
);

/** The consumer: calls whatever its `loud` port is bound to. */
const caller = defineApp(
  {
    name: "caller",
    version: "0.1.0",
    protocol: "1",
    provides: { actions: { run: { input: text, output: text } } },
    needs: { actions: { loud: { input: text, output: text } } },
  } as const satisfies Manifest,
  { actions: { run: async (input, ctx) => ctx.ports.loud(input) } },
);

/** Binds its own port to itself, so every call recurses. */
const looper = defineApp(
  {
    name: "looper",
    version: "0.1.0",
    protocol: "1",
    provides: { actions: { loop: { input: text, output: text } } },
    needs: { actions: { loop: { input: text, output: text } } },
  } as const satisfies Manifest,
  { actions: { loop: async (input, ctx) => ctx.ports.loop(input) } },
);

async function setup() {
  const env = testPlatform(caller);
  const provider = await env.install({ other: shouter });
  const run = (installId: string) => env.api("acme", "POST", `/api/installs/${installId}/actions/run`, { input: { text: "hi" } });
  return { ...env, provider, run };
}

describe("port binding", () => {
  it("forwards a bound port call to the provider install", async () => {
    const { install, provider, run } = await setup();
    const { installId } = await install({ bindings: { loud: { installId: provider.installId, action: "shout" } } });

    expect(await run(installId)).toEqual({ status: 200, body: { output: { text: "HI" } } });
  });

  it("passes the provider's errors through unchanged", async () => {
    const { install, provider, run } = await setup();
    const { installId } = await install({ bindings: { loud: { installId: provider.installId, action: "boom" } } });

    expect(await run(installId)).toEqual({ status: 422, body: { error: { code: 1002, message: "boom", data: { why: "test" } } } });
  });

  it("answers PortUnbound until the port is bound, then forwards", async () => {
    const { api, install, provider, run } = await setup();
    const { installId } = await install();

    expect((await run(installId)).body).toMatchObject({ error: { code: -32003 } });
    const bound = await api("acme", "PUT", `/api/installs/${installId}/bindings/loud`, {
      installId: provider.installId,
      action: "shout",
    });
    expect(bound.status).toBe(200);
    expect((await run(installId)).body).toEqual({ output: { text: "HI" } });
  });

  it("refuses bindings to another tenant, to missing actions and for undeclared ports", async () => {
    const { api, install, provider } = await setup();
    const { installId } = await install();
    const globex = await install({ other: shouter, tenant: "globex" });
    const bind = (port: string, binding: unknown, token = "acme") =>
      api(token, "PUT", `/api/installs/${installId}/bindings/${port}`, binding);

    expect((await bind("loud", { installId: globex.installId, action: "shout" })).status).toBe(403);
    expect((await bind("loud", { installId: provider.installId, action: "whisper" })).status).toBe(422);
    expect((await bind("quiet", { installId: provider.installId, action: "shout" })).status).toBe(422);
    expect((await bind("loud", { installId: provider.installId, action: "shout" }, "globex")).status).toBe(403);
  });

  it("stops a binding cycle at the depth limit", async () => {
    const { api, install } = await setup();
    const { installId } = await install({ other: looper });
    await api("acme", "PUT", `/api/installs/${installId}/bindings/loop`, { installId, action: "loop" });

    const { status, body } = await api("acme", "POST", `/api/installs/${installId}/actions/loop`, { input: { text: "x" } });
    expect(status).toBe(422);
    expect(body).toEqual({ error: { code: -32600, message: "port calls nested deeper than 8" } });
  });
});
