import { describe, expect, it } from "vitest";
import { formatTrace, parseTrace } from "./trace.js";

describe("trace metadata", () => {
  const traceparent = "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01";

  it("round trips", () => {
    const parent = parseTrace({ traceparent });
    expect(parent).toEqual({ traceId: "0af7651916cd43dd8448eb211c80319c", spanId: "b7ad6b7169203331", sampled: true });
    expect(formatTrace(parent!)).toEqual({ traceparent });
  });

  it("reads the sampling decision from the lowest flags bit", () => {
    expect(parseTrace({ traceparent: traceparent.replace(/01$/, "00") })?.sampled).toBe(false);
    expect(parseTrace({ traceparent: traceparent.replace(/01$/, "03") })?.sampled).toBe(true);
  });

  it("ignores anything outside version 00", () => {
    for (const value of [
      undefined,
      "x",
      { traceparent: 1 },
      { traceparent: traceparent.toUpperCase() },
      { traceparent: traceparent.replace(/^00/, "01") },
      { traceparent: `00-${"0".repeat(32)}-b7ad6b7169203331-01` },
      { traceparent: `00-0af7651916cd43dd8448eb211c80319c-${"0".repeat(16)}-01` },
      { traceparent: `${traceparent}-extra` },
    ]) {
      expect(parseTrace(value)).toBeUndefined();
    }
  });
});
