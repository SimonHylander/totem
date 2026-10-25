import type { Manifest } from "@totem/protocol";
import type { Principal } from "./access.js";

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
};

export type Connection = { readonly type: "apiKey"; readonly key: Sealed };

export type Install = {
  id: string;
  tenantId: string;
  appId: string;
  config: Record<string, unknown>;
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
  /** ADR 0008 callback token signing key. Whoever holds it can read every connected credential. */
  callbackKey: Sealed;
};

export function createStore(apiTokens: Map<string, Principal>): Store {
  return {
    apps: new Map(),
    installs: new Map(),
    apiTokens,
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
