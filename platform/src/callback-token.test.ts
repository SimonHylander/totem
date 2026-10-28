import { CallId, InstallId } from "@totem/ids";
import { CallDepth } from "@totem/runtime";
import { describe, expect, it } from "vitest";
import { mintCallbackToken, verifyCallbackToken } from "./callback-token.js";
import { Sealed } from "./store.js";

describe("callback tokens", () => {
  const key = new Sealed("key");
  const now = 1_000_000;
  const trace = { traceId: "0af7651916cd43dd8448eb211c80319c", spanId: "b7ad6b7169203331", sampled: true };

  it("expire five minutes after minting", () => {
    const token = mintCallbackToken(key, { installId: InstallId.make("install"), callId: CallId.make("call"), depth: CallDepth.make(2), trace }, now);
    expect(verifyCallbackToken(key, token, now + 299_999)).toEqual({ installId: "install", callId: "call", depth: 2, trace });
    expect(verifyCallbackToken(key, token, now + 300_000)).toBeNull();
  });
});
