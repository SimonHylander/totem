import { describe, expect, it } from "vitest";
import { ErrorCode } from "@totem/protocol";
import { appClient, defineApp, type Manifest } from "@totem/sdk";
import { Store } from "./store.js";
import { PLATFORM, testPlatform } from "./test-network.js";

const text = { type: "object", required: ["text"], properties: { text: { type: "string" } } } as const;

const shouter = defineApp(
  {
    name: "shouter",
    version: "0.1.0",
    protocol: "1",
    description: "Shouts text back.",
    provides: { actions: { shout: { input: text, output: text } } },
    needs: {},
  } as const satisfies Manifest,
  { actions: { shout: async ({ text }) => ({ text: text.toUpperCase() }) } },
);

/** Calls whatever its `loud` port is bound to. */
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

async function setup() {
  const env = testPlatform(caller);
  const own = await env.install();
  const shouterId = await env.register(shouter);
  await env.api("op", "POST", `/api/apps/${shouterId}/initialize`);
  const clientFor = (appId: string) =>
    appClient(caller, { secret: env.secrets.get(appId)!, platformUrl: `${PLATFORM}/rpc`, fetch: env.network });
  const client = clientFor(own.appId);
  const publish = (appId: string, token = "op") => env.api(token, "PUT", `/api/apps/${appId}/visibility`, { visibility: "public" });
  const installsOf = (appId: string) =>
    env.platform.runtime.runPromise(Store.use(({ installs }) => installs.all)).then((all) => all.filter((i) => i.appId === appId));
  return { ...env, own, shouterId, client, clientFor, publish, installsOf };
}

describe("apps/list", () => {
  it("lists public apps other than the caller, and only operators publish", async () => {
    const { client, own, shouterId, publish } = await setup();
    expect(await client.apps(own.installId)).toEqual([]);

    expect((await publish(shouterId, "acme")).status).toBe(403);
    await publish(shouterId);
    await publish(own.appId);

    expect(await client.apps(own.installId)).toEqual([
      { appId: shouterId, name: "shouter", description: "Shouts text back.", actions: shouter.manifest.provides.actions },
    ]);
  });
});

describe("ports/bind and ports/unbind", () => {
  it("binds a port to a public app, installing it once for the caller's tenant", async () => {
    const { client, clientFor, own, shouterId, publish, installsOf, install } = await setup();
    await publish(shouterId);
    const binding = { appId: shouterId, action: "shout" };

    await client.bind(own.installId, "loud", binding);
    await client.bind(own.installId, "loud", binding);
    expect(await client.ports(own.installId)).toEqual({ loud: { ...binding, name: "shouter", credentials: {} } });
    expect(await client.start(own.installId, "run", { text: "hi" })).toEqual({ text: "HI" });

    const globex = await install({ other: caller, tenant: "globex" });
    await clientFor(globex.appId).bind(globex.installId, "loud", binding);
    expect((await installsOf(shouterId)).map((i) => i.tenantId)).toEqual(["acme", "globex"]);
  });

  it("unbinds a port and keeps the provider install", async () => {
    const { client, own, shouterId, publish, installsOf } = await setup();
    await publish(shouterId);
    await client.bind(own.installId, "loud", { appId: shouterId, action: "shout" });

    await client.unbind(own.installId, "loud");
    expect(await client.ports(own.installId)).toEqual({ loud: null });
    await expect(client.start(own.installId, "run", { text: "hi" })).rejects.toMatchObject({ code: ErrorCode.PortUnbound });
    expect(await installsOf(shouterId)).toHaveLength(1);
  });

  it("refuses internal apps, unknown actions and undeclared ports", async () => {
    const { client, own, shouterId, publish } = await setup();
    const bind = (port: string, action = "shout") => client.bind(own.installId, port as "loud", { appId: shouterId, action });

    await expect(bind("loud")).rejects.toMatchObject({ code: ErrorCode.InvalidParams });
    await publish(shouterId);
    await expect(bind("loud", "whisper")).rejects.toMatchObject({ code: ErrorCode.ActionNotFound });
    await expect(bind("quiet")).rejects.toMatchObject({ code: ErrorCode.NotDeclared });
  });
});
