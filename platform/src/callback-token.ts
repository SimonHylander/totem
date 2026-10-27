import { createHmac, timingSafeEqual } from "node:crypto";
import type { Sealed } from "./store.js";

// ADR 0008 callback tokens. Minted per platform-to-app call and verified without a store lookup.
// Format: base64url(JSON claims) + "." + base64url(HMAC-SHA256(key, payload)).

export type CallbackClaims = {
  installId: string;
  /** Null for the install-scoped token that `install` and `uninstall` hooks receive. */
  callId: string | null;
  /** Unix seconds. */
  exp: number;
  /** How many port calls led here. Zero for calls the platform starts (ADR 0013). */
  depth: number;
};

const TTL_SECONDS = 5 * 60;

/** `now` is Unix milliseconds. */
export function mintCallbackToken(key: Sealed, installId: string, callId: string | null, depth: number, now: number): string {
  const claims: CallbackClaims = { installId, callId, depth, exp: Math.floor(now / 1000) + TTL_SECONDS };
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${payload}.${mac(key, payload)}`;
}

/** Null on a bad signature, malformed token or expiry. `now` is Unix milliseconds. */
export function verifyCallbackToken(key: Sealed, token: string, now: number): CallbackClaims | null {
  const [payload, signature, ...rest] = token.split(".");
  if (!payload || !signature || rest.length > 0) return null;
  const expected = Buffer.from(mac(key, payload));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString()) as CallbackClaims;
  return claims.exp * 1000 > now && Number.isInteger(claims.depth) ? claims : null;
}

function mac(key: Sealed, payload: string): string {
  return createHmac("sha256", key.reveal()).update(payload).digest("base64url");
}
