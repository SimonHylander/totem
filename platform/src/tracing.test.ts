import { describe, expect, it } from "vitest";
import { defineApp, type Manifest } from "@totem/sdk";
import { PLATFORM, spanRecorder, testPlatform } from "./test-network.js";

// One operation is one trace across the platform and every app it calls (ADR 0016).

const text = { type: "object", required: ["text"], properties: { text: { type: "string" } } } as const;

const shouter = defineApp(
  {
    name: "shouter",
    version: "0.1.0",
    protocol: "1",
    provides: { actions: { shout: { input: text, output: text } } },
    needs: {},
  } as const satisfies Manifest,
  { actions: { shout: async ({ text }) => ({ text: text.toUpperCase() }) } },
);

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

describe("tracing", () => {
  it("keeps a management call, the app, its port call and the provider in the caller's trace", async () => {
    const recorder = spanRecorder();
    const { platform, install } = testPlatform(caller, () => null, { tracer: recorder.tracer });
    const provider = await install({ other: shouter });
    const { installId } = await install({ bindings: { loud: { installId: provider.installId, action: "shout" } } });
    recorder.spans.length = 0;

    const traceId = "0af7651916cd43dd8448eb211c80319c";
    const response = await platform.handle(
      new Request(`${PLATFORM}/api/installs/${installId}/actions/run`, {
        method: "POST",
        headers: { authorization: "Bearer acme", traceparent: `00-${traceId}-b7ad6b7169203331-01` },
        body: JSON.stringify({ input: { text: "hi" } }),
      }),
    );
    expect(await response.json()).toEqual({ output: { text: "HI" } });

    const { named } = recorder;
    const parentOf = (name: string) => named(name).parent.pipe((p) => (p._tag === "Some" ? p.value.spanId : undefined));
    expect(new Set(recorder.spans.map((span) => span.traceId))).toEqual(new Set([traceId]));
    expect(parentOf("POST /api/installs/:installId/actions/:action")).toBe("b7ad6b7169203331");
    expect(parentOf("invoke run")).toBe(named("POST /api/installs/:installId/actions/:action").spanId);
    expect(parentOf("action run")).toBe(named("invoke run").spanId);
    // The callback hangs off the span in the token. The app's own span is only a link.
    expect(parentOf("rpc actions/invoke")).toBe(named("invoke run").spanId);
    expect(named("rpc actions/invoke").links.map((link) => link.span.spanId)).toEqual([named("action run").spanId]);
    expect(parentOf("invoke shout")).toBe(named("rpc actions/invoke").spanId);
    expect(parentOf("action shout")).toBe(named("invoke shout").spanId);
  });
});
