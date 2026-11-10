import type { AppId } from "@totem/ids";
import type { AppVersion } from "@totem/versions";
import { Context, Effect, Layer, Ref } from "effect";
import type { Principal } from "@totem/permissions";
import type { Session } from "./access.js";
import { NotFound } from "./errors.js";

// In-memory platform state. Everything is lost on restart (ADR 0011). Records are immutable: every
// write replaces the whole record through the Store, so a reader never sees a half-applied change.
// Installs live in their own module, `installs.ts`, which is their only writer. OAuth clients and
// pending connects live in `Connections` (`connections.ts`).

/**
 * A secret the platform holds. `reveal()` is the only read. JSON, string conversion and Node's
 * inspector print "[sealed]", so a log line or response body cannot carry the value by accident.
 */
export class Sealed {
  readonly #value: string;

  constructor(value: string) {
    this.#value = value;
  }

  reveal(): string {
    return this.#value;
  }

  toJSON() {
    return "[sealed]";
  }

  toString() {
    return "[sealed]";
  }

  [Symbol.for("nodejs.util.inspect.custom")]() {
    return "[sealed]";
  }
}

export type Visibility = "public" | "internal";

export type AppRecord = {
  readonly id: AppId;
  readonly url: string;
  /** ADR 0008 platform-to-app signing key, issued at registration. */
  readonly secret: Sealed;
  /** The version new installs get. Null until `initialize` has pulled a manifest (ADR 0017). */
  readonly latest: AppVersion | null;
  /** Set by an operator. `apps/list` shows only public apps, and `ports/bind` binds only to them (ADR 0015). */
  readonly visibility: Visibility;
};

/**
 * One collection of records keyed by `K`. Every operation is atomic, so a check and the write that
 * depends on it cannot interleave with another fiber's.
 */
export type Table<K extends string, V> = {
  readonly get: (key: K) => Effect.Effect<V, NotFound>;
  readonly lookup: (key: K) => Effect.Effect<V | undefined>;
  readonly all: Effect.Effect<ReadonlyArray<V>>;
  readonly put: (value: V) => Effect.Effect<void>;
  /** Replace a record with `f`'s result and return the new record. */
  readonly update: (key: K, f: (value: V) => V) => Effect.Effect<V, NotFound>;
};

function makeTable<K extends string, V>(noun: string, keyOf: (value: V) => K): Effect.Effect<Table<K, V>> {
  return Effect.map(Ref.make<ReadonlyMap<K, V>>(new Map()), (ref): Table<K, V> => {
    const notFound = (key: K) => new NotFound({ message: `no ${noun} ${key}` });
    return {
      get: (key) =>
        Effect.flatMap(Ref.get(ref), (map) => {
          const value = map.get(key);
          return value === undefined ? Effect.fail(notFound(key)) : Effect.succeed(value);
        }),
      lookup: (key) => Effect.map(Ref.get(ref), (map) => map.get(key)),
      all: Effect.map(Ref.get(ref), (map) => [...map.values()]),
      put: (value) => Ref.update(ref, (map) => withEntry(map, keyOf(value), value)),
      update: (key, f) =>
        Effect.flatten(
          Ref.modify(ref, (map): readonly [Effect.Effect<V, NotFound>, ReadonlyMap<K, V>] => {
            const value = map.get(key);
            if (value === undefined) return [Effect.fail(notFound(key)), map];
            const next = f(value);
            return [Effect.succeed(next), withEntry(map, key, next)];
          }),
        ),
    };
  });
}

/** A copy of `map` with `key` set to `value`, or without `key` when `value` is undefined. */
export function withEntry<K, V>(map: ReadonlyMap<K, V>, key: K, value: V | undefined): ReadonlyMap<K, V> {
  const next = new Map(map);
  if (value === undefined) next.delete(key);
  else next.set(key, value);
  return next;
}

/** The platform's state. One per platform, seeded with the management tokens by SHA-256 hex. */
export class Store extends Context.Service<
  Store,
  {
    readonly apps: Table<AppId, AppRecord>;
    readonly sessions: Table<string, Session>;
    readonly apiTokens: ReadonlyMap<string, Principal>;
    /** ADR 0008 callback token signing key. Whoever holds it can read every connected credential. */
    readonly callbackKey: Sealed;
  }
>()("@totem/platform/Store") {
  static readonly layer = (apiTokens: ReadonlyMap<string, Principal>) =>
    Layer.effect(
      Store,
      Effect.gen(function* () {
        return Store.of({
          apps: yield* makeTable("app", (app: AppRecord) => app.id),
          sessions: yield* makeTable("session", (session: Session) => session.id),
          apiTokens,
          callbackKey: new Sealed(randomToken()),
        });
      }),
    );
}

/** 32 random bytes, base64url. Used for secrets, IDs that act as capabilities, and OAuth state. */
export function randomToken(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
}

/** Deployment settings every operation can read. */
export class PlatformConfig extends Context.Service<
  PlatformConfig,
  {
    /** The platform's public origin, such as `http://localhost:3000`. */
    readonly baseUrl: string;
    /** Accept `http://localhost` provider endpoints. Development only. */
    readonly allowLocalhost: boolean;
  }
>()("@totem/platform/PlatformConfig") {}
