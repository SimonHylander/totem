import { AppId, InstallId, TenantId, VersionId } from "@totem/ids";
import { providesAction } from "@totem/installs";
import type { Manifest } from "@totem/protocol";
import type { AppVersion } from "@totem/versions";
import { DateTime, Effect } from "effect";
import { describe, expect, it } from "vitest";
import { Installs } from "./installs.js";

const acme = TenantId.make("acme");
const globex = TenantId.make("globex");

const version = (app: string, provides: string[], needs: string[] = []): AppVersion => {
  const signatures = (names: string[]) => Object.fromEntries(names.map((name) => [name, { input: {}, output: {} }]));
  const manifest: Manifest = {
    name: app,
    version: "0.1.0",
    protocol: "1",
    provides: { actions: signatures(provides) },
    needs: { actions: signatures(needs) },
  };
  return { id: VersionId.make(`${app}-v1`), appId: AppId.make(app), manifest, pulledAt: DateTime.makeUnsafe(0) };
};

const crm = version("crm", ["upsert"]);
const events = version("events", [], ["sync"]);

const run = <A, E>(effect: Effect.Effect<A, E, Installs>) => Effect.runPromise(effect.pipe(Effect.provide(Installs.layer)));

describe("Installs", () => {
  it("stores nothing when a binding fails its checks", async () => {
    const outcome = await run(
      Effect.gen(function* () {
        const installs = yield* Installs;
        const provider = yield* installs.create(globex, crm, {}, {});
        const error = yield* Effect.flip(installs.create(acme, events, {}, { sync: { installId: provider.id, action: "upsert" } }));
        return { error: error._tag, stored: (yield* installs.all).length };
      }),
    );
    expect(outcome).toEqual({ error: "ForeignInstall", stored: 1 });
  });

  it("fails an undeclared port before a missing provider", async () => {
    const error = await run(
      Effect.gen(function* () {
        const installs = yield* Installs;
        return yield* Effect.flip(installs.create(acme, events, {}, { quiet: { installId: InstallId.make("gone"), action: "upsert" } }));
      }),
    );
    expect(error._tag).toBe("PortNotDeclared");
  });

  it("shares one provider per tenant and app, and creates none for a version it refuses", async () => {
    const outcome = await run(
      Effect.gen(function* () {
        const installs = yield* Installs;
        const provides = (action: string) => (v: AppVersion) => providesAction(v.manifest, action, v.manifest.name);
        const refused = yield* Effect.flip(installs.provider(acme, crm, provides("delete")));
        const [first, second] = yield* Effect.all([installs.provider(acme, crm, provides("upsert")), installs.provider(acme, crm, provides("upsert"))], {
          concurrency: "unbounded",
        });
        return { refused: refused._tag, created: [first.created, second.created], same: first.install.id === second.install.id };
      }),
    );
    expect(outcome).toEqual({ refused: "ActionNotProvided", created: [true, false], same: true });
  });

  it("activates a Pending install once", async () => {
    const outcome = await run(
      Effect.gen(function* () {
        const installs = yield* Installs;
        const { id } = yield* installs.create(acme, crm, {}, {});
        const active = yield* installs.activate(id);
        const again = yield* Effect.flip(installs.activate(id));
        const missing = yield* Effect.flip(installs.activate(InstallId.make("gone")));
        return [active.status._tag, again._tag, missing._tag];
      }),
    );
    expect(outcome).toEqual(["Active", "IllegalTransition", "NotFound"]);
  });
});
