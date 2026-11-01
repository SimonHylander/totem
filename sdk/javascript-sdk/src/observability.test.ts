import { describe, expect, it } from "vitest";
import { Layer, Logger, ManagedRuntime, Tracer } from "effect";
import { SIGNATURE_HEADER, sign, type JsonRpcRequest } from "@totem/protocol";
import { defineApp } from "./define-app.js";
import { fakePlatform } from "./fake-platform.js";
import { createHandler } from "./handler.js";

const text = { type: "object", required: ["text"], properties: { text: { type: "string" } } } as const;

const app = defineApp(
  {
    name: "echo",
    version: "0.1.0",
    protocol: "1",
    provides: { actions: { echo: { input: text, output: text } } },
    needs: { state: true, actions: { shout: { input: text, output: text } } },
  } as const,
  {
    actions: {
      echo: async ({ text }, ctx) => {
        await ctx.state.set("last", text);
        await ctx.log.info("echoed", { text });
        return ctx.ports.shout({ text });
      },
    },
  },
);

/** A runtime whose tracer records every span and whose logger keeps every line. */
function recording() {
  const spans: Tracer.Span[] = [];
  const lines: ReturnType<typeof Logger.formatStructured.log>[] = [];
  const tracer = Tracer.make({
    span: (options) => {
      const span = new Tracer.NativeSpan(options);
      spans.push(span);
      return span;
    },
  });
  const runtime = ManagedRuntime.make(
    Layer.mergeAll(
      Layer.succeed(Tracer.Tracer, tracer),
      Logger.layer([Logger.make((entry) => void lines.push(Logger.formatStructured.log(entry)))]),
    ),
  );
  const named = (name: string) => spans.find((span) => span.name === name)!;
  return { runtime, spans, lines, named };
}

const parent = { traceId: "0af7651916cd43dd8448eb211c80319c", spanId: "b7ad6b7169203331" };
const context = { tenantId: "t1", installId: "i1", config: {}, callId: "c1" };

describe("observability", () => {
  it("continues the platform's trace and names the action span on every callback", async () => {
    const { runtime, named } = recording();
    const callbacks: JsonRpcRequest[] = [];
    const fetch: typeof globalThis.fetch = async (_url, init) => {
      const request = JSON.parse(String(init?.body)) as JsonRpcRequest;
      callbacks.push(request);
      const result = request.method === "actions/invoke" ? { output: { text: "HI" } } : {};
      return Response.json({ jsonrpc: "2.0", id: request.id, result });
    };
    const handle = createHandler(app, { secret: "s", platformUrl: "http://platform.test/rpc", fetch, observability: { runtime } });

    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "actions/invoke",
      params: { action: "echo", input: { text: "hi" }, context, callbackToken: "tok" },
      trace: { traceparent: `00-${parent.traceId}-${parent.spanId}-01` },
    });
    await handle(new Request("http://app.test/", { method: "POST", headers: { [SIGNATURE_HEADER]: await sign("s", body) }, body }));

    const action = named("action echo");
    expect(action.traceId).toBe(parent.traceId);
    expect(action.parent).toMatchObject({ value: { spanId: parent.spanId } });
    expect(action.attributes.get("totem.call_id")).toBe("c1");
    expect(callbacks.map((request) => [request.method, request.trace])).toEqual([
      ["state/set", { traceparent: `00-${parent.traceId}-${action.spanId}-01` }],
      ["log", { traceparent: `00-${parent.traceId}-${action.spanId}-01` }],
      ["actions/invoke", { traceparent: `00-${parent.traceId}-${action.spanId}-01` }],
    ]);
    expect(named("port shout").parent).toMatchObject({ value: { spanId: action.spanId } });
    await runtime.dispose();
  });

  it("writes author lines to the app's logger instead of the platform", async () => {
    const { runtime, lines, named } = recording();
    const platform = fakePlatform(app, { ports: { shout: async ({ text }) => ({ text }) } });

    await app.invoke("echo", { text: "hi" }, { platform, context, observability: { runtime, logs: "local" } });

    expect(platform.logs).toEqual([]);
    expect(lines).toMatchObject([
      { level: "INFO", message: ["echoed", { text: "hi" }], annotations: { callId: "c1", installId: "i1", spanId: named("action echo").spanId } },
    ]);
    await runtime.dispose();
  });
});
