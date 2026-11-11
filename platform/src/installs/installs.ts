import { InstallId, type TenantId } from "@totem/ids";
import {
  HookSucceeded,
  Pending,
  checkBinding,
  declaresPort,
  transition,
  withBinding,
  type ActionNotProvided,
  type ForeignInstall,
  type IllegalTransition,
  InstallRepo,
  type InstallCore,
  type PortBinding,
  type PortNotDeclared,
} from "@totem/installs";
import { requireCompatible, type AppVersion, type IncompatibleVersion } from "@totem/versions";
import { Context, Effect, Layer, Ref, Result } from "effect";
import type { Connection, OAuthConnection } from "../connections/connections.js";
import { NotFound, StateConflict } from "../errors.js";
import { withEntry } from "../table.js";

export type Install = InstallCore & {
  readonly connections: ReadonlyMap<string, Connection>;
  readonly state: ReadonlyMap<string, StateEntry>;
  /**
   * The version the latest state write took. Every write takes the next one, so a key never gets
   * back a version it had before, even after it was deleted and set again.
   */
  readonly stateVersion: number;
};

export type StateEntry = { readonly value: unknown; readonly version: number };

/** The ways binding a port can fail (ADR 0013). NotFound names a missing provider install. */
type BindingError = NotFound | PortNotDeclared | ForeignInstall | ActionNotProvided;

export class Installs extends Context.Service<
  Installs,
  {
    readonly get: (id: InstallId) => Effect.Effect<Install, NotFound>;
    readonly lookup: (id: InstallId) => Effect.Effect<Install | undefined>;
    /** Every install, oldest first. */
    readonly all: Effect.Effect<ReadonlyArray<Install>>;
    /** Store a Pending install of `version`, with each of `bindings` checked against its stored provider. */
    readonly create: (
      tenantId: TenantId,
      version: AppVersion,
      config: Readonly<Record<string, unknown>>,
      bindings: Readonly<Record<string, PortBinding>>,
    ) => Effect.Effect<Install, BindingError>;
    /**
     * The tenant's first install of `latest.appId`, or a new Pending install of `latest` with empty
     * config. `accept` vets the version the provider runs before anything is stored, so concurrent
     * callers share one provider install. `created` says whether this call stored it.
     */
    readonly provider: <E>(
      tenantId: TenantId,
      latest: AppVersion,
      accept: (version: AppVersion) => Result.Result<void, E>,
    ) => Effect.Effect<{ install: Install; created: boolean }, E>;
    /** Mark a Pending install Active once its `install` hook succeeded, or the app has none. */
    readonly activate: (id: InstallId) => Effect.Effect<Install, NotFound | IllegalTransition>;
    readonly remove: (id: InstallId) => Effect.Effect<void>;
    /** Bind `port` after the ADR 0013 checks, or unbind it when `binding` is undefined. */
    readonly bind: (id: InstallId, port: string, binding: PortBinding | undefined) => Effect.Effect<void, BindingError>;
    /** Move the install to `version` if the change is compatible (ADR 0017). Returns the version it runs afterwards. */
    readonly upgrade: (id: InstallId, version: AppVersion) => Effect.Effect<AppVersion, NotFound | IncompatibleVersion>;
    readonly connect: (id: InstallId, name: string, connection: Connection) => Effect.Effect<void, NotFound>;
    /**
     * Store a refresh's result: `next`, or no connection when it is undefined. Applies only while
     * `expected` is still stored, so a reconnect that landed meanwhile wins. Returns the stored
     * oauth2 connection afterwards, or null, including when the install was deleted.
     */
    readonly replaceConnection: (
      id: InstallId,
      name: string,
      expected: OAuthConnection,
      next: OAuthConnection | undefined,
    ) => Effect.Effect<OAuthConnection | null>;
    /**
     * Set one state key, or delete it when `value` is null. With `expected`, the write applies only
     * if the key is still at that version (0 when unset). Returns the key's new version, 0 when deleted.
     */
    readonly setState: (
      id: InstallId,
      key: string,
      value: unknown,
      expected: number | undefined,
    ) => Effect.Effect<number, NotFound | StateConflict>;
  }
>()("@totem/platform/Installs") {
  static readonly layer = Layer.effect(
    Installs,
    Effect.gen(function* () {
      // A ReadonlyMap replaced on every write keeps insertion order, which "first install" relies on.
      const ref = yield* Ref.make<Stored>(new Map());

      /** Apply `f` to the collection atomically. A failure writes nothing. */
      const write = <A, E>(f: (all: Stored) => Result.Result<readonly [A, Stored], E>): Effect.Effect<A, E> =>
        Effect.flatten(
          Ref.modify(ref, (all): readonly [Effect.Effect<A, E>, Stored] => {
            const result = f(all);
            return Result.isSuccess(result)
              ? [Effect.succeed(result.success[0]), result.success[1]]
              : [Effect.fail(result.failure), all];
          }),
        );

      const update = <E>(
        id: InstallId,
        f: (install: Install, all: Stored) => Result.Result<Install, E>,
      ): Effect.Effect<Install, E | NotFound> =>
        write<Install, E | NotFound>((all) => {
          const install = all.get(id);
          if (!install) return Result.fail(notFound(id));
          return Result.map(f(install, all), (next) => [next, withEntry(all, id, next)] as const);
        });

      return Installs.of({
        get: (id) =>
          Effect.flatMap(Ref.get(ref), (all) => {
            const install = all.get(id);
            return install ? Effect.succeed(install) : Effect.fail(notFound(id));
          }),
        lookup: (id) => Effect.map(Ref.get(ref), (all) => all.get(id)),
        all: Effect.map(Ref.get(ref), (all) => [...all.values()]),

        create: (tenantId, version, config, bindings) =>
          write((all) =>
            Result.gen(function* () {
              let install = newInstall(tenantId, version, config);
              for (const [port, binding] of Object.entries(bindings)) {
                install = withBinding(install, port, yield* checked(install, port, binding, all));
              }
              return [install, withEntry(all, install.id, install)] as const;
            }),
          ),

        provider: (tenantId, latest, accept) =>
          write((all) => {
            const found = [...all.values()].find((install) => install.tenantId === tenantId && install.appId === latest.appId);
            const install = found ?? newInstall(tenantId, latest, {});
            const stored: Stored = found ? all : withEntry(all, install.id, install);
            return Result.map(accept(install.version), () => [{ install, created: !found }, stored] as const);
          }),

        activate: (id) =>
          update(id, (install) => Result.map(transition(install.status, HookSucceeded.make({})), (status) => ({ ...install, status }))),

        remove: (id) => Ref.update(ref, (all) => withEntry(all, id, undefined)),

        bind: (id, port, binding) =>
          update(id, (install, all) =>
            Result.gen(function* () {
              if (binding === undefined) {
                yield* declaresPort(install.version.manifest, port);
                return withBinding(install, port, undefined);
              }
              return withBinding(install, port, yield* checked(install, port, binding, all));
            }),
          ).pipe(Effect.asVoid),

        upgrade: (id, version) =>
          update(id, (install) =>
            install.version.id === version.id
              ? Result.succeed(install)
              : Result.map(requireCompatible(install.version.manifest, version.manifest), () => ({ ...install, version })),
          ).pipe(Effect.map((install) => install.version)),

        connect: (id, name, connection) =>
          update(id, (install) => Result.succeed({ ...install, connections: withEntry(install.connections, name, connection) })).pipe(
            Effect.asVoid,
          ),

        replaceConnection: (id, name, expected, next) =>
          update(id, (install) =>
            Result.succeed(
              install.connections.get(name) === expected
                ? { ...install, connections: withEntry(install.connections, name, next) }
                : install,
            ),
          ).pipe(
            Effect.map((install) => {
              const stored = install.connections.get(name);
              return stored?.type === "oauth2" ? stored : null;
            }),
            Effect.catchTag("NotFound", () => Effect.succeed(null)),
          ),

        setState: (id, key, value, expected) =>
          update(id, (install) => {
            const current = install.state.get(key)?.version ?? 0;
            if (expected !== undefined && expected !== current) {
              return Result.fail(new StateConflict({ message: `state "${key}" is at version ${current}, not ${expected}` }));
            }
            const version = install.stateVersion + 1;
            const entry = value === null ? undefined : { value, version };
            return Result.succeed({ ...install, state: withEntry(install.state, key, entry), stateVersion: version });
          }).pipe(Effect.map((install) => install.state.get(key)?.version ?? 0)),
      });
    }),
  );
}

export const installRepoLayer = Layer.effect(
  InstallRepo,
  Effect.gen(function* () {
    const { lookup } = yield* Installs;
    return InstallRepo.of({ lookup });
  }),
);

type Stored = ReadonlyMap<InstallId, Install>;

const notFound = (id: InstallId) => new NotFound({ message: `no install ${id}` });

function newInstall(tenantId: TenantId, version: AppVersion, config: Readonly<Record<string, unknown>>): Install {
  return {
    id: InstallId.make(crypto.randomUUID()),
    tenantId,
    appId: version.appId,
    version,
    status: Pending.make({}),
    config,
    bindings: new Map(),
    connections: new Map(),
    state: new Map(),
    stateVersion: 0,
  };
}

const checked = (install: Install, port: string, binding: PortBinding, all: Stored): Result.Result<PortBinding, BindingError> =>
  Result.gen(function* () {
    yield* declaresPort(install.version.manifest, port);
    const provider = all.get(binding.installId);
    if (!provider) return yield* Result.fail(notFound(binding.installId));
    return yield* checkBinding(install, port, provider, binding.action);
  });
