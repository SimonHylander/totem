import type { Endpoint, Manifest } from "@totem/protocol";
import type { Principal, Session } from "./access.js";

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

export type AppRecord = {
  id: string;
  url: string;
  /** ADR 0008 platform-to-app signing key, issued at registration. */
  secret: Sealed;
  /** Null until `initialize` has pulled it. */
  manifest: Manifest | null;
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
      readonly expiresAt: Date;
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
  /** Only the session that started the connect may finish it. */
  sessionId: string;
  expiresAt: Date;
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

export type Store = {
  apps: Map<string, AppRecord>;
  installs: Map<string, Install>;
  /** Management tokens by SHA-256 hex. Seeded from config. */
  apiTokens: Map<string, Principal>;
  sessions: Map<string, Session>;
  pendingConnects: Map<string, PendingConnect>;
  /** One in-flight refresh per connection record. Concurrent `credentials/get` calls await it. */
  refreshes: WeakMap<OAuthConnection, Promise<OAuthConnection | null>>;
  /** ADR 0008 callback token signing key. Whoever holds it can read every connected credential. */
  callbackKey: Sealed;
};

export function createStore(apiTokens: Map<string, Principal>): Store {
  return {
    apps: new Map(),
    installs: new Map(),
    apiTokens,
    sessions: new Map(),
    pendingConnects: new Map(),
    refreshes: new WeakMap(),
    callbackKey: new Sealed(randomToken()),
  };
}

/** 32 random bytes, base64url. Used for secrets, IDs that act as capabilities, and OAuth state. */
export function randomToken(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
}

/** What every platform operation needs besides its arguments. */
export type Context = {
  store: Store;
  /** The platform's public origin, such as `http://localhost:3000`. */
  baseUrl: string;
  /** Accept `http://localhost` provider endpoints. Development only. */
  allowLocalhost: boolean;
  fetch: typeof fetch;
};
