// Platform to app request signing. Header `X-Ipaas-Signature: t=<unix>,v1=<hex>`
// where v1 = HMAC-SHA256(secret, `${t}.${body}`).

export const SIGNATURE_HEADER = "x-ipaas-signature";

const DEFAULT_TOLERANCE_SECONDS = 300;

async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(mac), (b) => b.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Produce the header value for a request body. */
export async function sign(
  secret: string,
  body: string,
  timestamp = Math.floor(Date.now() / 1000),
): Promise<string> {
  return `t=${timestamp},v1=${await hmac(secret, `${timestamp}.${body}`)}`;
}

/** Check a header value against a request body. False on any malformed input. */
export async function verify(
  secret: string,
  header: string | null,
  body: string,
  { now = Math.floor(Date.now() / 1000), tolerance = DEFAULT_TOLERANCE_SECONDS } = {},
): Promise<boolean> {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(",").map((kv) => kv.split("=", 2)));
  const timestamp = Number(parts["t"]);
  const given = parts["v1"];
  if (!Number.isInteger(timestamp) || typeof given !== "string") return false;
  if (Math.abs(now - timestamp) > tolerance) return false;
  return constantTimeEqual(given, await hmac(secret, `${timestamp}.${body}`));
}
