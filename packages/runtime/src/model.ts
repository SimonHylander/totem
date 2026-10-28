import { Schema } from "effect";

// Invoking actions on installed apps (ADR 0013).

/** A port call at this depth fails, so a binding cycle cannot loop. */
export const MAX_CALL_DEPTH = 8;

/** How many port calls led to a call. Zero for calls the platform starts. Never above MAX_CALL_DEPTH. */
export const CallDepth = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: MAX_CALL_DEPTH })).pipe(
  Schema.brand("CallDepth"),
);
export type CallDepth = typeof CallDepth.Type;
