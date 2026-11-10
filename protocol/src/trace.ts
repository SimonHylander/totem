import { Schema } from "effect";

// Trace metadata (ADR 0016). Mirrors `trace.schema.json`. A request carries it as its `trace` member.

const TRACEPARENT = /^00-(?!0{32}-)([0-9a-f]{32})-(?!0{16}-)([0-9a-f]{16})-([0-9a-f]{2})$/;

/** The `trace` member of a JSON-RPC request. */
export const TraceMetadata = Schema.Struct({ traceparent: Schema.String.check(Schema.isPattern(TRACEPARENT)) });
export type TraceMetadata = typeof TraceMetadata.Type;

/** The span a request continues, decoded from `TraceMetadata`. */
export type TraceParent = { traceId: string; spanId: string; sampled: boolean };

const isTraceMetadata = Schema.is(TraceMetadata);

/** Decode a received `trace` member. Undefined for anything missing or invalid, never an error. */
export function parseTrace(trace: unknown): TraceParent | undefined {
  const match = isTraceMetadata(trace) ? TRACEPARENT.exec(trace.traceparent) : null;
  if (!match) return undefined;
  const [, traceId, spanId, flags] = match;
  return { traceId: traceId!, spanId: spanId!, sampled: (parseInt(flags!, 16) & 1) === 1 };
}

export function formatTrace({ traceId, spanId, sampled }: TraceParent): TraceMetadata {
  return { traceparent: `00-${traceId}-${spanId}-${sampled ? "01" : "00"}` };
}
