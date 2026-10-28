import { AppId, InstallId, TenantId, VersionId } from "@totem/ids";
import { Active, type InstallCore } from "@totem/installs";
import { DateTime, Result } from "effect";
import { describe, expect, it } from "vitest";
import { authorize, can, type Authorized } from "./authorize.js";
import type { ManagementAction, Principal } from "./model.js";

const acme = TenantId.make("acme");
const install: InstallCore = {
  id: InstallId.make("i-1"),
  tenantId: acme,
  appId: AppId.make("a-1"),
  version: {
    id: VersionId.make("v-1"),
    appId: AppId.make("a-1"),
    manifest: { name: "crm", version: "1.0.0", protocol: "1", provides: {}, needs: {} },
    pulledAt: DateTime.makeUnsafe(0),
  },
  status: Active.make({}),
  config: {},
  bindings: new Map(),
};
const foreign: InstallCore = { ...install, tenantId: TenantId.make("globex") };

const operator: Principal = { id: "simon", role: { name: "operator" } };
const admin: Principal = { id: "alice", role: { name: "tenantAdmin", tenantId: acme } };

/** Every action, with whether a tenant admin of acme may perform it. Operators may perform all of them. */
const table: [ManagementAction, boolean][] = [
  [{ type: "app.register" }, false],
  [{ type: "app.setOAuthClient" }, false],
  [{ type: "app.setVisibility" }, false],
  [{ type: "install.create", tenantId: acme }, true],
  [{ type: "install.create", tenantId: TenantId.make("globex") }, false],
  [{ type: "install.connect", install }, true],
  [{ type: "install.connect", install: foreign }, false],
  [{ type: "install.bind", install }, true],
  [{ type: "install.bind", install: foreign }, false],
  [{ type: "install.invoke", install }, true],
  [{ type: "install.invoke", install: foreign }, false],
  [{ type: "install.upgrade", install }, true],
  [{ type: "install.upgrade", install: foreign }, false],
];

describe("can", () => {
  for (const [action, allowed] of table) {
    const tenant = "tenantId" in action ? action.tenantId : "install" in action ? action.install.tenantId : "";
    it(`${action.type} ${tenant}: operator yes, tenant admin ${allowed ? "yes" : "no"}`, () => {
      expect(can(operator, action)).toBe(true);
      expect(can(admin, action)).toBe(allowed);
    });
  }
});

describe("authorize", () => {
  it("mints proof for an allowed action and Forbidden otherwise", () => {
    const allowed = authorize(admin, { type: "install.invoke", install });
    expect(Result.isSuccess(allowed) && allowed.success.action.install).toBe(install);
    const refused = authorize(admin, { type: "app.register" });
    expect(Result.isFailure(refused) && refused.failure.message).toBe("alice may not app.register");
  });

  it("cannot be forged, copied into another action or moved to another tenant", () => {
    const proof = Result.getOrThrow(authorize(admin, { type: "install.create", tenantId: acme }));

    // @ts-expect-error only authorize mints proof
    const literal: Authorized<{ type: "app.register" }> = { principal: operator, action: { type: "app.register" } };
    // @ts-expect-error a spread copy drops the private fields
    // eslint-disable-next-line @typescript-eslint/no-misused-spread -- the forgery under test
    const swapped: Authorized<{ type: "app.register" }> = { ...proof, action: { type: "app.register" } };
    // @ts-expect-error the same holds for another tenant
    // eslint-disable-next-line @typescript-eslint/no-misused-spread -- the forgery under test
    const moved: Authorized<{ type: "install.create"; tenantId: TenantId }> = { ...proof, action: { type: "install.create", tenantId: TenantId.make("globex") } };
    // @ts-expect-error a proof for one action is not a proof for another
    const other: Authorized<{ type: "app.register" }> = proof;

    expect(() => {
      // @ts-expect-error the authorized action is read-only
      proof.action.tenantId = TenantId.make("globex");
    }).toThrow(TypeError);
    expect(proof.action.tenantId).toBe(acme);

    const action = { type: "install.create" as const, tenantId: acme };
    const copied = Result.getOrThrow(authorize(admin, action));
    action.tenantId = TenantId.make("globex");
    expect(copied.action.tenantId).toBe(acme);

    expect([literal, swapped, moved, other].map((forged) => forged.action.type)).toEqual([
      "app.register",
      "app.register",
      "install.create",
      "install.create",
    ]);
  });
});
