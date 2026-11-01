import type { AppId, InstallId } from "@totem/ids";
import type { Endpoint } from "@totem/protocol";
import type { AppVersion } from "@totem/versions";
import { Context, type DateTime, type Deferred, Effect, Layer, Ref } from "effect";
import type { Principal } from "@totem/permissions";
import type { Session } from "./access.js";
import { NotFound, type ProviderFailed } from "./errors.js";

// In-memory platform state. Everything is lost on restart (ADR 0011). Records are immutable: every
// write replaces the whole record through the Store, so a reader never sees a half-applied change.
// Installs live in their own module, `installs.ts`, which is their only writer.

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
      /** Token response fields other than the tokens, kept as returned. */
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

/**
 * One collection of records keyed by `K`. Every operation is atomic, so a check and the write that
 * depends on it cannot interleave with another fiber's.
 */
export type Table<K extends string, V> = {
  readonly get: (key: K) => Effect.Effect<V, NotFound>;
  readonly lookup: (key: K) => Effect.Effect<V | undefined>;
  readonly all: Effect.Effect<ReadonlyArray<V>>;
  readonly put: (value: V) => Effect.Effect<void>;
  /** Remove and return a record, so only one caller can use it. */
  readonly take: (key: K) => Effect.Effect<V | undefined>;
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
      take: (key) => Ref.modify(ref, (map) => [map.get(key), withEntry(map, key, undefined)] as const),
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
    /** Keyed by `state`. */
    readonly pendingConnects: Table<string, PendingConnect>;
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
