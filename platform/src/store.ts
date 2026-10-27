import type { Endpoint, Manifest } from "@totem/protocol";
import { Context, type DateTime, type Deferred, Layer } from "effect";
import type { Principal, Session } from "./access.js";
import type { ProviderFailed } from "./errors.js";

// In-memory platform state. Everything is lost on restart (ADR 0011).

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
  id: string;
  url: string;
  /** ADR 0008 platform-to-app signing key, issued at registration. */
  secret: Sealed;
  /** Null until `initialize` has pulled it. */
  manifest: Manifest | null;
  /** Set by an operator. `apps/list` shows only public apps, and `ports/bind` binds only to them (ADR 0015). */
  visibility: Visibility;
  /** The current OAuth client by credential name. No management endpoint returns these. */
  oauthBindings: Map<string, OAuthBinding>;
};

/**
 * The provider OAuth client for one oauth2 credential, set by an operator (ADR 0012). Immutable
 * apart from `clientSecret`. A different client ID or different endpoints make a new binding object,
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
  installId: string;
  credential: string;
  binding: OAuthBinding;
  /**
   * Only the session that started the connect may finish it. Null when an app started it through
   * `ports/connect`, because the app, not the platform, knows who the user is (ADR 0015).
   */
  sessionId: string | null;
  /** Where the callback redirects. Null shows the platform's own "Connected" page. */
  returnTo: string | null;
  expiresAt: DateTime.Utc;
};

/** Where a port's calls go: an action on another install of the same tenant (ADR 0013). */
export type PortBinding = { installId: string; action: string };

export type Install = {
  id: string;
  tenantId: string;
  appId: string;
  config: Record<string, unknown>;
  /** By port name. A declared port with no entry is unbound. */
  bindings: Map<string, PortBinding>;
  /** By credential name. Deleting the install deletes them. */
  connections: Map<string, Connection>;
  /** Install-scoped key-value state for apps that declare `needs.state`. */
  state: Map<string, unknown>;
};

export type StoreData = {
  apps: Map<string, AppRecord>;
  installs: Map<string, Install>;
  /** Management tokens by SHA-256 hex. Seeded from config. */
  apiTokens: Map<string, Principal>;
  sessions: Map<string, Session>;
  pendingConnects: Map<string, PendingConnect>;
  /** One in-flight refresh per connection record. Concurrent `credentials/get` calls await it. */
  refreshes: WeakMap<OAuthConnection, Deferred.Deferred<OAuthConnection | null, ProviderFailed>>;
  /** ADR 0008 callback token signing key. Whoever holds it can read every connected credential. */
  callbackKey: Sealed;
};

/** The platform's state. One per platform, seeded with the management tokens by SHA-256 hex. */
export class Store extends Context.Service<Store, StoreData>()("@totem/platform/Store") {
  static readonly layer = (apiTokens: Map<string, Principal>) =>
    Layer.sync(Store, () => ({
      apps: new Map(),
      installs: new Map(),
      apiTokens,
      sessions: new Map(),
      pendingConnects: new Map(),
      refreshes: new WeakMap(),
      callbackKey: new Sealed(randomToken()),
    }));
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
