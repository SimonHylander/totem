/** Trace metadata (ADR 0016), the `trace` member of a JSON-RPC request. Mirrors `trace.schema.json`. */
export type TraceMetadata = { traceparent: string };

/** The span a request continues, decoded from `TraceMetadata`. */
export type TraceParent = { traceId: string; spanId: string; sampled: boolean };

const TRACEPARENT = /^00-(?!0{32}-)([0-9a-f]{32})-(?!0{16}-)([0-9a-f]{16})-([0-9a-f]{2})$/;

/** Decode a received `trace` member. Undefined for anything missing or invalid, never an error. */
export function parseTrace(trace: unknown): TraceParent | undefined {
  if (typeof trace !== "object" || trace === null || !("traceparent" in trace)) return undefined;
  const match = typeof trace.traceparent === "string" ? TRACEPARENT.exec(trace.traceparent) : null;
  if (!match) return undefined;
  const [, traceId, spanId, flags] = match;
  return { traceId: traceId!, spanId: spanId!, sampled: (parseInt(flags!, 16) & 1) === 1 };
}

export function formatTrace({ traceId, spanId, sampled }: TraceParent): TraceMetadata {
  return { traceparent: `00-${traceId}-${spanId}-${sampled ? "01" : "00"}` };
}
