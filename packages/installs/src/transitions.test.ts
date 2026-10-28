import { AppId, InstallId, TenantId, VersionId } from "@totem/ids";
import type { Manifest } from "@totem/protocol";
import { DateTime, Result } from "effect";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { Active, HookSucceeded, Pending, type InstallCore, type InstallEvent, type InstallStatus } from "./model.js";
import { checkBinding, requireActive, transition, withBinding } from "./transitions.js";

const statuses: InstallStatus[] = [Pending.make({}), Active.make({})];
const events: InstallEvent[] = [HookSucceeded.make({})];

/** Every (status, event) pair and the status it leads to, or null when it is illegal. */
const table: [InstallStatus, InstallEvent, InstallStatus["_tag"] | null][] = [
  [Pending.make({}), HookSucceeded.make({}), "Active"],
  [Active.make({}), HookSucceeded.make({}), null],
];

const manifest = (needs: string[], provides: string[]): Manifest => ({
  name: "app",
  version: "0.1.0",
  protocol: "1",
  provides: { actions: Object.fromEntries(provides.map((action) => [action, { input: {}, output: {} }])) },
  needs: { actions: Object.fromEntries(needs.map((port) => [port, { input: {}, output: {} }])) },
});

/** An Active install of acme running `app` with `appManifest`. */
const install = (overrides: Partial<InstallCore> = {}, appManifest = manifest([], [])): InstallCore => ({
  id: InstallId.make("consumer"),
  tenantId: TenantId.make("acme"),
  appId: AppId.make("app"),
  version: { id: VersionId.make("v1"), appId: AppId.make("app"), manifest: appManifest, pulledAt: DateTime.makeUnsafe(0) },
  status: Active.make({}),
  bindings: new Map(),
  ...overrides,
});

describe("transition", () => {
  it("covers every status and event", () => {
    const pairs = statuses.flatMap((status) => events.map((event) => [status._tag, event._tag]));
    expect(table.map(([status, event]) => [status._tag, event._tag])).toEqual(pairs);
  });

  for (const [from, event, to] of table) {
    it(`${from._tag} + ${event._tag} → ${to ?? "illegal"}`, () => {
      const result = transition(from, event);
      if (to === null) expect(Result.isFailure(result) && result.failure._tag).toBe("IllegalTransition");
      else expect(Result.isSuccess(result) && result.success._tag).toBe(to);
    });
  }

  it("activates at most once, and an active install stays active", () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom(...events)), (sequence) => {
        let status: InstallStatus = Pending.make({});
        let activations = 0;
        for (const event of sequence) {
          const next = transition(status, event);
          if (Result.isFailure(next)) continue;
          if (next.success._tag === "Active") activations++;
          expect(status._tag === "Active" && next.success._tag !== "Active").toBe(false);
          status = next.success;
        }
        expect(activations).toBeLessThanOrEqual(1);
      }),
    );
  });
});

describe("requireActive", () => {
  it("refuses a pending install", () => {
    expect(Result.isFailure(requireActive(install({ status: Pending.make({}) })))).toBe(true);
    expect(Result.isSuccess(requireActive(install()))).toBe(true);
  });
});

describe("checkBinding", () => {
  const consumer = install({}, manifest(["crm"], []));
  const provider = install({ id: InstallId.make("provider") }, manifest([], ["upsert"]));
  const failure = (result: Result.Result<unknown, { _tag: string }>) => Result.isFailure(result) && result.failure._tag;

  it("binds a declared port to an action of the same tenant", () => {
    expect(checkBinding(consumer, "crm", provider, "upsert")).toEqual(
      Result.succeed({ installId: InstallId.make("provider"), action: "upsert" }),
    );
  });

  it("refuses undeclared ports, other tenants and missing actions", () => {
    const foreign = { ...provider, tenantId: TenantId.make("globex") };
    expect(failure(checkBinding(consumer, "mail", provider, "upsert"))).toBe("PortNotDeclared");
    expect(failure(checkBinding(consumer, "crm", foreign, "upsert"))).toBe("ForeignInstall");
    expect(failure(checkBinding(consumer, "crm", provider, "delete"))).toBe("ActionNotProvided");
    expect(failure(checkBinding(consumer, "constructor", provider, "upsert"))).toBe("PortNotDeclared");
    expect(failure(checkBinding(consumer, "crm", provider, "constructor"))).toBe("ActionNotProvided");
  });
});

describe("withBinding", () => {
  it("binds and unbinds without changing the original", () => {
    const original = install();
    const bound = withBinding(original, "crm", { installId: InstallId.make("provider"), action: "upsert" });
    expect(bound.bindings.get("crm")?.action).toBe("upsert");
    expect(original.bindings.size).toBe(0);
    expect(withBinding(bound, "crm", undefined).bindings.size).toBe(0);
  });
});
