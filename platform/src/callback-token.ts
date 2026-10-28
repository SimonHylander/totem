import { createHmac, timingSafeEqual } from "node:crypto";
import { CallId, InstallId } from "@totem/ids";
import { formatTrace, parseTrace, type TraceParent } from "@totem/protocol";
import { Option, Schema } from "effect";
import type { Sealed } from "./store.js";

// ADR 0008 callback tokens. Minted per platform-to-app call and verified without a store lookup.
// Format: base64url(JSON claims) + "." + base64url(HMAC-SHA256(key, payload)).

export type CallbackClaims = {
  installId: InstallId;
  /** Null for the install-scoped token that `install` and `uninstall` hooks receive. */
  callId: CallId | null;
  /** How many port calls led here. Zero for calls the platform starts (ADR 0013). */
  depth: number;
  /** The platform span that made the call. Callbacks are its children (ADR 0016). */
  trace: TraceParent | undefined;
};

const TTL_SECONDS = 5 * 60;

/** The signed payload. `trace` is parsed separately, so a malformed one reads as absent. */
const Payload = Schema.fromJsonString(
  Schema.Struct({
    installId: InstallId,
    callId: Schema.NullOr(CallId),
    depth: Schema.Int,
    exp: Schema.Number,
    trace: Schema.optionalKey(Schema.Unknown),
  }),
);

/** `now` is Unix milliseconds. */
export function mintCallbackToken(key: Sealed, { trace, ...claims }: CallbackClaims, now: number): string {
  const payload = Buffer.from(
    JSON.stringify({ ...claims, ...(trace && { trace: formatTrace(trace) }), exp: Math.floor(now / 1000) + TTL_SECONDS }),
  ).toString("base64url");
  return `${payload}.${mac(key, payload)}`;
}

/** Null on a bad signature, malformed token or expiry. `now` is Unix milliseconds. */
export function verifyCallbackToken(key: Sealed, token: string, now: number): CallbackClaims | null {
  const [payload, signature, ...rest] = token.split(".");
  if (!payload || !signature || rest.length > 0) return null;
  const expected = Buffer.from(mac(key, payload));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  const claims = Schema.decodeUnknownOption(Payload)(Buffer.from(payload, "base64url").toString());
  if (Option.isNone(claims)) return null;
  const { installId, callId, depth, exp, trace } = claims.value;
  if (exp * 1000 <= now) return null;
  return { installId, callId, depth, trace: parseTrace(trace) };
}

function mac(key: Sealed, payload: string): string {
  return createHmac("sha256", key.reveal()).update(payload).digest("base64url");
}
