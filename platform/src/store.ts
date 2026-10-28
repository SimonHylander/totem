import type { AppId, InstallId, TenantId } from "@totem/ids";
import type { Endpoint, Manifest } from "@totem/protocol";
import { Context, type DateTime, type Deferred, Effect, Layer, Ref } from "effect";
import type { Principal, Session } from "./access.js";
import { NotFound, type ProviderFailed } from "./errors.js";

// In-memory platform state. Everything is lost on restart (ADR 0011). Records are immutable: every
// write replaces the whole record through the Store, so a reader never sees a half-applied change.

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
  /** Null until `initialize` has pulled it. */
  readonly manifest: Manifest | null;
  /** Set by an operator. `apps/list` shows only public apps, and `ports/bind` binds only to them (ADR 0015). */
  readonly visibility: Visibility;
  /** The current OAuth client by credential name. No management endpoint returns these. */
  readonly oauthBindings: ReadonlyMap<string, OAuthBinding>;
};

/**
 * The provider OAuth client for one oauth2 credential, set by an operator (ADR 0012). Immutable
 * apart from `clientSecret`, the one record field written in place. A different client ID or different endpoints make a new binding object,
 * so grants made under the old binding are never sent to the new endpoints. Grants and pending
 * connects hold the object itself and compare by identity.
 */
export type OAuthBinding = {
  /**
   * Names the redirect URI. Derived from the endpoints, so the URI survives a restart and can be
   * registered at the provider ahead of time. Two bindings for one provider share it.
   */
  id: string;
  clientId: string;
  /** Replaced in place when the operator rotates the secret of the same client. */
  clientSecret: Sealed;
  /** The manifest endpoints when the operator set this client. The platform calls only these. */
  pinned: { authorizeUrl: Endpoint; tokenUrl: Endpoint };
};

/**
 * A connected credential. Each write replaces the whole record, so comparing records by identity
 * detects a concurrent change.
 */
export type Connection =
  | {
      readonly type: "oauth2";
      /** The binding that issued these tokens. If the app's current binding differs, this reads as missing. */
      readonly binding: OAuthBinding;
      readonly accessToken: Sealed;
      readonly expiresAt: DateTime.Utc;
      /** Null if the provider issued none. The connection then ends at `expiresAt`. */
      readonly refreshToken: Sealed | null;
      /** Token response fields other than the tokens, kept as returned. HubSpot's `hub_id` will route webhooks. */
      readonly providerFields: Readonly<Record<string, unknown>>;
    }
  | { readonly type: "apiKey"; readonly key: Sealed };

export type OAuthConnection = Extract<Connection, { type: "oauth2" }>;

/** An OAuth connect in progress. Keyed by its `state` value and removed on first use. */
export type PendingConnect = {
  readonly state: string;
  readonly installId: InstallId;
  readonly credential: string;
  readonly binding: OAuthBinding;
  /**
   * Only the session that started the connect may finish it. Null when an app started it through
   * `ports/connect`, because the app, not the platform, knows who the user is (ADR 0015).
   */
  readonly sessionId: string | null;
  /** Where the callback redirects. Null shows the platform's own "Connected" page. */
  readonly returnTo: string | null;
  readonly expiresAt: DateTime.Utc;
};

/** Where a port's calls go: an action on another install of the same tenant (ADR 0013). */
export type PortBinding = { readonly installId: InstallId; readonly action: string };

export type Install = {
  readonly id: InstallId;
  readonly tenantId: TenantId;
  readonly appId: AppId;
  readonly config: Readonly<Record<string, unknown>>;
  /** By port name. A declared port with no entry is unbound. */
  readonly bindings: ReadonlyMap<string, PortBinding>;
  /** By credential name. Deleting the install deletes them. */
  readonly connections: ReadonlyMap<string, Connection>;
  /** Install-scoped key-value state for apps that declare `needs.state`. */
  readonly state: ReadonlyMap<string, unknown>;
};

/**
 * One collection of records keyed by `K`. Every operation is atomic, so a check and the write that
 * depends on it cannot interleave with another fiber's.
 */
export type Table<K extends string, V> = {
  /** The record, or NotFound. */
  readonly get: (key: K) => Effect.Effect<V, NotFound>;
  /** The record, or undefined. */
  readonly lookup: (key: K) => Effect.Effect<V | undefined>;
  readonly all: Effect.Effect<ReadonlyArray<V>>;
  readonly put: (value: V) => Effect.Effect<void>;
  readonly remove: (key: K) => Effect.Effect<void>;
  /** Remove and return a record, so only one caller can use it. */
  readonly take: (key: K) => Effect.Effect<V | undefined>;
  /** Replace a record with `f`'s result and return the new record. */
  readonly update: (key: K, f: (value: V) => V) => Effect.Effect<V, NotFound>;
  /** Replace a record with `f`'s second value and return its first. */
  readonly modify: <A>(key: K, f: (value: V) => readonly [A, V]) => Effect.Effect<A, NotFound>;
  /** The first record matching `predicate`, or a new one from `create`. `created` says which. */
  readonly findOrPut: (predicate: (value: V) => boolean, create: () => V) => Effect.Effect<{ value: V; created: boolean }>;
};

function makeTable<K extends string, V>(noun: string, keyOf: (value: V) => K): Effect.Effect<Table<K, V>> {
  // A ReadonlyMap replaced on every write keeps insertion order, which "first install" relies on.
  return Effect.map(Ref.make<ReadonlyMap<K, V>>(new Map()), (ref): Table<K, V> => {
    const notFound = (key: K) => new NotFound({ message: `no ${noun} ${key}` });
    const table: Table<K, V> = {
      get: (key) =>
        Effect.flatMap(Ref.get(ref), (map) => {
          const value = map.get(key);
          return value === undefined ? Effect.fail(notFound(key)) : Effect.succeed(value);
        }),
      lookup: (key) => Effect.map(Ref.get(ref), (map) => map.get(key)),
      all: Effect.map(Ref.get(ref), (map) => [...map.values()]),
      put: (value) => Ref.update(ref, (map) => withEntry(map, keyOf(value), value)),
      remove: (key) => Ref.update(ref, (map) => withEntry(map, key, undefined)),
      take: (key) => Ref.modify(ref, (map) => [map.get(key), withEntry(map, key, undefined)] as const),
      update: (key, f) =>
        table.modify(key, (value) => {
          const next = f(value);
          return [next, next];
        }),
      modify: <A,>(key: K, f: (value: V) => readonly [A, V]) =>
        Effect.flatten(
          Ref.modify(ref, (map): readonly [Effect.Effect<A, NotFound>, ReadonlyMap<K, V>] => {
            const value = map.get(key);
            if (value === undefined) return [Effect.fail(notFound(key)), map];
            const [result, next] = f(value);
            return [Effect.succeed(result), withEntry(map, key, next)];
          }),
        ),
      findOrPut: (predicate, create) =>
        Ref.modify(ref, (map): readonly [{ value: V; created: boolean }, ReadonlyMap<K, V>] => {
          const found = [...map.values()].find(predicate);
          if (found !== undefined) return [{ value: found, created: false }, map];
          const value = create();
          return [{ value, created: true }, withEntry(map, keyOf(value), value)];
        }),
    };
    return table;
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
    readonly installs: Table<InstallId, Install>;
    readonly sessions: Table<string, Session>;
    /** Keyed by `state`. */
    readonly pendingConnects: Table<string, PendingConnect>;
    /** Management tokens by SHA-256 hex. Seeded from config. */
    readonly apiTokens: ReadonlyMap<string, Principal>;
    /** One in-flight refresh per connection record. Concurrent `credentials/get` calls await it. */
    readonly refreshes: WeakMap<OAuthConnection, Deferred.Deferred<OAuthConnection | null, ProviderFailed>>;
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
          installs: yield* makeTable("install", (install: Install) => install.id),
          sessions: yield* makeTable("session", (session: Session) => session.id),
          pendingConnects: yield* makeTable("connect", (pending: PendingConnect) => pending.state),
          apiTokens,
          refreshes: new WeakMap(),
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
