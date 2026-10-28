import { AppId, InstallId, TenantId, VersionId } from "@totem/ids";
import { Active, InstallRepo, Pending, type InstallCore } from "@totem/installs";
import type { Manifest } from "@totem/protocol";
import { DateTime, Effect, Exit, Layer, Result } from "effect";
import { describe, expect, it } from "vitest";
import { deeper, forward } from "./forward.js";
import { CallDepth, MAX_CALL_DEPTH } from "./model.js";
import { AppTransport } from "./port.js";

const signature = { input: {}, output: {} };
const manifest = (needs: string[]): Manifest => ({
  name: "app",
  version: "1.0.0",
  protocol: "1",
  provides: { actions: { shout: signature } },
  needs: { actions: Object.fromEntries(needs.map((port) => [port, signature])) },
});

const install = (id: string, overrides: Partial<InstallCore> = {}): InstallCore => ({
  id: InstallId.make(id),
  tenantId: TenantId.make("acme"),
  appId: AppId.make("app"),
  version: { id: VersionId.make("v1"), appId: AppId.make("app"), manifest: manifest(["loud"]), pulledAt: DateTime.makeUnsafe(0) },
  status: Active.make({}),
  config: {},
  bindings: new Map(),
  ...overrides,
});

const caller = install("caller", { bindings: new Map([["loud", { installId: InstallId.make("provider"), action: "shout" }]]) });

/** Forward `port` from `from` at `depth` against `installs`. Records the transport calls. */
function run(installs: InstallCore[], from: InstallCore, port: string, depth = 0) {
  const calls: { install: string; action: string; depth: number }[] = [];
  const layer = Layer.mergeAll(
    Layer.succeed(InstallRepo, { lookup: (id) => Effect.succeed(installs.find((i) => i.id === id)) }),
    Layer.succeed(AppTransport, {
      invoke: (target, action, input, next) => {
        calls.push({ install: target.id, action, depth: next });
        return Effect.succeed(input);
      },
    }),
  );
  const exit = Effect.runSyncExit(forward(from, port, { text: "hi" }, CallDepth.make(depth)).pipe(Effect.provide(layer)));
  const failure = Exit.isFailure(exit) ? exit.cause.reasons.map((reason) => ("error" in reason ? (reason.error as { _tag: string })._tag : "defect")) : [];
  return { exit, calls, failure: failure[0] };
}

describe("forward", () => {
  it("runs the bound action on the provider one level deeper", () => {
    const { exit, calls } = run([install("provider")], caller, "loud", 2);
    expect(Exit.isSuccess(exit) && exit.value).toEqual({ text: "hi" });
    expect(calls).toEqual([{ install: "provider", action: "shout", depth: 3 }]);
  });

  it("refuses undeclared, unbound and cross-tenant ports, nesting past the limit and pending providers", () => {
    expect(run([install("provider")], caller, "quiet").failure).toBe("PortNotDeclared");
    expect(run([], caller, "loud").failure).toBe("PortUnbound");
    expect(run([install("provider", { tenantId: TenantId.make("globex") })], caller, "loud").failure).toBe("PortUnbound");
    expect(run([install("provider")], caller, "loud", MAX_CALL_DEPTH).failure).toBe("CallDepthExceeded");
    expect(run([install("provider", { status: Pending.make({}) })], caller, "loud").failure).toBe("InstallNotActive");
    const unprovided = install("caller", { bindings: new Map([["loud", { installId: InstallId.make("provider"), action: "whisper" }]]) });
    expect(run([install("provider")], unprovided, "loud").failure).toBe("ActionNotProvided");
  });
});

describe("deeper", () => {
  it("counts up to the limit and no further", () => {
    expect(deeper(CallDepth.make(MAX_CALL_DEPTH - 1))).toEqual(Result.succeed(MAX_CALL_DEPTH));
    expect(Result.isFailure(deeper(CallDepth.make(MAX_CALL_DEPTH)))).toBe(true);
    expect(() => CallDepth.make(MAX_CALL_DEPTH + 1)).toThrow();
  });
});
