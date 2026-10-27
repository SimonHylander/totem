import { describe, expect, it } from "vitest";
import { mintCallbackToken, verifyCallbackToken } from "./callback-token.js";
import { Sealed } from "./store.js";

describe("callback tokens", () => {
  const key = new Sealed("key");
  const now = 1_000_000;

  it("expire five minutes after minting", () => {
    const token = mintCallbackToken(key, "install", "call", 2, now);
    expect(verifyCallbackToken(key, token, now + 299_999)).toEqual({ installId: "install", callId: "call", depth: 2, exp: 1300 });
    expect(verifyCallbackToken(key, token, now + 300_000)).toBeNull();
  });
});
