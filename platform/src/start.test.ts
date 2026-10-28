import { describe, expect, it } from "vitest";
import { ErrorCode, SIGNATURE_HEADER, sign } from "@totem/protocol";
import { appClient, defineApp, type Manifest } from "@totem/sdk";
import { PLATFORM, testPlatform } from "./test-network.js";

/** Counts how often `count` ran on each install, in install state. */
const counter = defineApp(
  {
    name: "counter",
    version: "0.1.0",
    protocol: "1",
    provides: {
      actions: {
        count: {
          input: { type: "object" },
          output: { type: "object", required: ["count"], properties: { count: { type: "number" } } },
        },
      },
    },
    needs: { state: true },
  } as const satisfies Manifest,
  {
    actions: {
      count: async (_input, ctx) => {
        const count = ((await ctx.state.get<number>("count")) ?? 0) + 1;
        await ctx.state.set("count", count);
        return { count };
      },
    },
  },
);

async function setup() {
  const env = testPlatform(counter);
  const own = await env.install();
  const other = await env.install({ other: counter });
  const client = (secret: string) => appClient(counter, { secret, platformUrl: `${PLATFORM}/rpc`, fetch: env.network });
  return { ...env, own, other, client, start: client(env.secrets.get(own.appId)!).start };
}

describe("actions/start", () => {
  it("runs the app's own action with the install's context", async () => {
    const { own, start } = await setup();

    expect(await start(own.installId, "count", {})).toEqual({ count: 1 });
    expect(await start(own.installId, "count", {})).toEqual({ count: 2 });
  });

  it("refuses a wrong secret, another app's install and an unknown install alike", async () => {
    const { own, other, client, start } = await setup();
    const unauthorized = { code: ErrorCode.Unauthorized };

    await expect(client("wrong").start(own.installId, "count", {})).rejects.toMatchObject(unauthorized);
    await expect(start(other.installId, "count", {})).rejects.toMatchObject(unauthorized);
    await expect(start("no-such-install", "count", {})).rejects.toMatchObject(unauthorized);
  });

  it("refuses actions the app does not provide", async () => {
    const { own, start } = await setup();
    await expect(start(own.installId, "reset" as "count", {})).rejects.toMatchObject({ code: ErrorCode.ActionNotFound });
  });

  it("accepts only actions/start with a signature", async () => {
    const { network, secrets, own } = await setup();
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "state/get", params: { key: "count" } });
    const response = await network(`${PLATFORM}/rpc`, {
      method: "POST",
      headers: { [SIGNATURE_HEADER]: await sign(secrets.get(own.appId)!, body) },
      body,
    });
    expect(await response.json()).toMatchObject({ error: { code: ErrorCode.MethodNotFound } });
  });

  it("refuses an install whose install hook has not finished", async () => {
    let refused: unknown;
    const early = defineApp(counter.manifest, {
      ...counter.handlers,
      install: async ({ installId }) => {
        refused = await appClient(counter, { secret: env.secrets.get(appId)!, platformUrl: `${PLATFORM}/rpc`, fetch: env.network })
          .start(installId, "count", {})
          .catch((error: unknown) => error);
      },
    });
    const env = testPlatform(early);
    const appId = await env.register();
    await env.api("op", "POST", `/api/apps/${appId}/initialize`);
    await env.api("acme", "POST", "/api/tenants/acme/installs", { appId });

    expect(refused).toMatchObject({ code: ErrorCode.InvalidRequest });
  });
});
