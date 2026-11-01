import { Schema } from "effect";

/**
 * An app answered a platform call with a JSON-RPC error. The platform passes it through unchanged,
 * so a forwarded port call surfaces the provider's own error (ADR 0013).
 */
export class AppFailed extends Schema.TaggedError<AppFailed>()("AppFailed", {
  code: Schema.Number,
  message: Schema.String,
  data: Schema.optional(Schema.Unknown),
}) {}

/** A declared port with no provider install in the caller's tenant. */
export class PortUnbound extends Schema.TaggedError<PortUnbound>()("PortUnbound", { message: Schema.String }) {}

/** A port call nested past MAX_CALL_DEPTH. */
export class CallDepthExceeded extends Schema.TaggedError<CallDepthExceeded>()("CallDepthExceeded", {
  message: Schema.String,
}) {}
