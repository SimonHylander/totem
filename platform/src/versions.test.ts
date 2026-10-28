import { describe, expect, it } from "vitest";
import { appClient, defineApp, type Manifest } from "@totem/sdk";
import { PLATFORM, testPlatform } from "./test-network.js";

const text = { type: "object", required: ["text"], properties: { text: { type: "string" } } } as const;
const signature = { input: text, output: text };

const shouter = defineApp(
  {
    name: "shouter",
    version: "0.1.0",
    protocol: "1",
    provides: { actions: { shout: signature } },
    needs: {},
  } as const satisfies Manifest,
  { actions: { shout: async ({ text }) => ({ text: text.toUpperCase() }) } },
);

const v1 = {
  name: "caller",
  version: "1.0.0",
  protocol: "1",
  provides: { actions: { run: signature } },
  needs: {},
} as const satisfies Manifest;

/** An app whose next `initialize` returns whatever manifest the test sets. Its code serves every action. */
const caller = defineApp(
  { ...v1, provides: { actions: { run: signature, echo: signature } } } as const satisfies Manifest,
  { actions: { run: async (input) => input, echo: async (input) => input } },
);
const release = (manifest: Manifest) => {
  (caller as { manifest: Manifest }).manifest = manifest;
};

describe("app versions", () => {
  it("keeps an install on its version until it upgrades, and refuses a breaking upgrade", async () => {
    release(v1);
    const { api, install } = testPlatform(caller);
    const provider = await install({ other: shouter });
    const { appId, installId } = await install();
    const initialize = () => api("op", "POST", `/api/apps/${appId}/initialize`);
    const bind = () => api("acme", "PUT", `/api/installs/${installId}/bindings/loud`, { installId: provider.installId, action: "shout" });
    const upgrade = () => api("acme", "POST", `/api/installs/${installId}/upgrade`);

    const echo = () => api("acme", "POST", `/api/installs/${installId}/actions/echo`, { input: { text: "hi" } });

    const v2 = {
      ...v1,
      version: "1.1.0",
      provides: { actions: { run: signature, echo: signature } },
      needs: { actions: { loud: signature } },
    } satisfies Manifest;
    release(v2);
    await initialize();
    expect((await bind()).status).toBe(422);
    expect((await echo()).status).toBe(422);

    expect(await upgrade()).toMatchObject({ status: 200, body: { version: "1.1.0" } });
    expect((await bind()).status).toBe(200);
    expect(await echo()).toEqual({ status: 200, body: { output: { text: "hi" } } });

    release({ ...v2, version: "2.0.0", provides: {} });
    await initialize();
    expect(await upgrade()).toMatchObject({
      status: 409,
      body: { error: "version 2.0.0 removes or changes provides.actions.run, provides.actions.echo" },
    });
  });

  it("binds a port to the action an existing provider's pinned version provides", async () => {
    const provider = defineApp(shouter.manifest, shouter.handlers);
    const env = testPlatform(provider);
    const { appId: shouterId } = await env.install();
    await env.api("op", "PUT", `/api/apps/${shouterId}/visibility`, { visibility: "public" });
    const consumer = defineApp(
      { name: "consumer", version: "1.0.0", protocol: "1", provides: {}, needs: { actions: { loud: signature } } } as const satisfies Manifest,
      { actions: {} },
    );
    const { appId, installId } = await env.install({ other: consumer });
    const client = appClient(consumer, { secret: env.secrets.get(appId)!, platformUrl: `${PLATFORM}/rpc`, fetch: env.network });

    // The shouter's code still serves shout, but its latest manifest drops it. The tenant's install pins the old one.
    (provider as { manifest: Manifest }).manifest = { ...shouter.manifest, version: "0.2.0", provides: { actions: {} } };
    await env.api("op", "POST", `/api/apps/${shouterId}/initialize`);

    await client.bind(installId, "loud", { appId: shouterId, action: "shout" });
    expect((await client.ports(installId))["loud"]).toMatchObject({ appId: shouterId, action: "shout" });
  });
});
