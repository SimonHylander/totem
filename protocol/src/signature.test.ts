import { describe, expect, it } from "vitest";
import { sign, verify } from "./signature.js";

describe("signature", () => {
  const secret = "s3cret";
  const body = '{"jsonrpc":"2.0","id":1,"method":"health"}';

  it("round trips", async () => {
    const header = await sign(secret, body, 1_000_000);
    expect(await verify(secret, header, body, { now: 1_000_000 })).toBe(true);
  });

  it("rejects a changed body, wrong secret, stale timestamp and garbage", async () => {
    const header = await sign(secret, body, 1_000_000);
    expect(await verify(secret, header, body + " ", { now: 1_000_000 })).toBe(false);
    expect(await verify("other", header, body, { now: 1_000_000 })).toBe(false);
    expect(await verify(secret, header, body, { now: 1_000_301 })).toBe(false);
    expect(await verify(secret, "nope", body)).toBe(false);
    expect(await verify(secret, null, body)).toBe(false);
  });
});
