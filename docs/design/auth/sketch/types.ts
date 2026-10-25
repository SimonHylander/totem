import type { JSONSchema } from "../../../../protocol/node_modules/json-schema-to-ts";

// Part 1 is a modified copy of protocol/src/types.ts. Changes are marked CHANGED or NEW.
// Part 2 is new platform-side code for the `platform/` package. None of part 2 is on the
// wire, and apps never see it.

// ===========================================================================
// Part 1. Protocol (protocol/src/types.ts)
// ===========================================================================

// Hand-written mirrors of the JSON Schemas in this folder. Keep them in sync.
// TypeScript reads manifests at compile time through `as const`, so the
// manifest type must accept literal schemas. Codegen is for Python and Go.

export const PROTOCOL_VERSION = "1";

/** An action or a port: a named input/output pair. */
export type Signature = {
  description?: string;
  input: JSONSchema;
  output: JSONSchema;
};

export type Trigger = {
  description?: string;
  payload: JSONSchema;
};

/**
 * NEW. An absolute https URL, or http on localhost for development. Mirrors `$defs/endpoint`.
 * The template is approximate (`http://localhost:80@evil.example` fits it). The platform parses
 * every endpoint at registration and checks the real hostname.
 */
export type Endpoint = `https://${string}` | `http://localhost:${string}` | `http://localhost/${string}`;

/**
 * NEW. OAuth 2.0 authorization code grant with refresh tokens. The app declares the provider's
 * endpoints because the app knows the provider. The platform runs the flow with the OAuth client
 * an operator set for this credential, and calls only the endpoints that operator pinned.
 */
export type OAuth2Need = {
  type: "oauth2";
  /** Where the platform sends the tenant's browser for consent. */
  authorizeUrl: Endpoint;
  /** Where the platform exchanges codes and refreshes tokens. It receives the client secret. */
  tokenUrl: Endpoint;
  /** Scopes to request, sent space-separated. The tenant consents to exactly these. */
  scopes: readonly string[];
};

/** NEW. A static key the tenant enters when connecting. */
export type ApiKeyNeed = {
  type: "apiKey";
};

/**
 * CHANGED. Was `{ type: "oauth2" | "apiKey"; scopes?: readonly string[] }`. Now one member per
 * credential type, each with only its own fields. A new type is a new member.
 */
export type CredentialNeed = OAuth2Need | ApiKeyNeed;

/** What an app provides and what it needs. Returned from `initialize`. */
export type Manifest = {
  name: string;
  version: string;
  protocol: typeof PROTOCOL_VERSION;
  description?: string;
  provides: {
    actions?: Record<string, Signature>;
    triggers?: Record<string, Trigger>;
  };
  needs: {
    credentials?: Record<string, CredentialNeed>;
    state?: boolean;
    actions?: Record<string, Signature>;
  };
  config?: JSONSchema;
};

export type InstallContext = {
  tenantId: string;
  installId: string;
  config: Record<string, unknown>;
};

export type CallContext = InstallContext & {
  callId: string;
  idempotencyKey?: string;
  deadline?: string;
};

export type CredentialValue =
  | { type: "oauth2"; accessToken: string; expiresAt: string }
  | { type: "apiKey"; key: string };

/**
 * NEW. The value `credentials/get` returns for a need. SDKs type `credentials.get(name)` with it,
 * so a handler needs no runtime type check and a new union member breaks no existing app.
 */
export type CredentialValueFor<N> = N extends { type: infer T } ? Extract<CredentialValue, { type: T }> : never;

export type LogLevel = "debug" | "info" | "warn" | "error";

/** Methods the platform calls on an app. */
export type AppMethods = {
  initialize: {
    params: { protocolVersion: typeof PROTOCOL_VERSION; platformUrl: string };
    result: { manifest: Manifest };
  };
  health: {
    params: Record<string, never>;
    result: { status: "ok" };
  };
  install: {
    params: { context: InstallContext; callbackToken: string };
    result: Record<string, never>;
  };
  uninstall: {
    params: { context: InstallContext; callbackToken: string };
    result: Record<string, never>;
  };
  "actions/invoke": {
    params: { action: string; input: unknown; context: CallContext; callbackToken: string };
    result: { output: unknown };
  };
};

/** Methods an app calls on the platform. Tenant and install come from the bearer token. */
export type PlatformMethods = {
  "credentials/get": {
    params: { name: string };
    result: CredentialValue;
  };
  "state/get": {
    params: { key: string };
    result: { value: unknown };
  };
  "state/set": {
    params: { key: string; value: unknown };
    result: Record<string, never>;
  };
  log: {
    params: { level: LogLevel; message: string; data?: Record<string, unknown> };
    result: Record<string, never>;
  };
  "actions/invoke": {
    params: { port: string; input: unknown };
    result: { output: unknown };
  };
};

/** Protocol error codes. See protocol/README.md. Unchanged: auth reuses -32001, -32002 and -32005. */
export const ErrorCode = {
  ProtocolVersionUnsupported: -32000,
  NotDeclared: -32001,
  CredentialMissing: -32002,
  PortUnbound: -32003,
  ActionNotFound: -32004,
  Unauthorized: -32005,
  DeadlineExceeded: -32006,
  // JSON-RPC standard
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603,
  ParseError: -32700,
} as const;

// ===========================================================================
// Part 2. Platform (new `platform/` package, in-memory storage)
// ===========================================================================

declare const sealedBrand: unique symbol;

/**
 * A secret the platform holds. `reveal()` is the only read. JSON and string conversion give
 * "[sealed]", so a log line or a response body cannot carry the value by accident.
 */
export type Sealed = { readonly [sealedBrand]: true; reveal(): string };

/** The only way to make a `Sealed`. */
export function seal(value: string): Sealed {
  throw new Error("not implemented");
}

// ---------------------------------------------------------------------------
// Layer 1: who may administer Totem. Only the management API (`/api/*`) uses it.
// ---------------------------------------------------------------------------

export type Role = { name: "operator" } | { name: "tenantAdmin"; tenantId: string };

/** The holder of a management API token: a person or a CI job. `id` names it in logs. */
export type Principal = { id: string; role: Role };

/**
 * Every management operation in the slice. Install-scoped actions carry the stored install,
 * so the tenant that `can` compares comes from the store, never from the request.
 */
export type ManagementAction =
  | { type: "app.register" }
  | { type: "app.setOAuthClient"; app: string }
  | { type: "install.create"; tenantId: string }
  | { type: "install.connect"; install: Install }
  | { type: "install.invoke"; install: Install };

/** Resolve a management API bearer token by its SHA-256 hex. Null means HTTP 401. */
export function authenticate(store: Store, bearer: string): Principal | null {
  throw new Error("not implemented");
}

/**
 * A browser signed in to the platform. OAuth consent needs one, because the provider redirect is
 * a plain browser GET and the platform must know that the browser finishing a connect is the one
 * that started it (RFC 6749 section 10.12). Sent as an HttpOnly, SameSite=Lax cookie.
 */
export type Session = { id: string; principal: Principal; expiresAt: Date };

/**
 * `POST /session` with a management token in the body. The development login until an identity
 * provider replaces it. The token never appears in a URL.
 */
export function signIn(store: Store, token: string): Session | null {
  throw new Error("not implemented");
}

/**
 * The only authorization rule. Every management function calls it before it acts, so a route
 * cannot skip it. Custom roles, audit and approvals later change this function, not its callers.
 */
export function can(principal: Principal, action: ManagementAction): boolean {
  // TODO: operator → true.
  // TODO: tenantAdmin → true when the action's tenant equals role.tenantId. The action's tenant is
  //       `tenantId` for install.create and `install.tenantId` for install-scoped actions.
  //       App actions → false.
  throw new Error("not implemented");
}

// ---------------------------------------------------------------------------
// ADR 0008 identities. These identify workloads, not layer 1 principals.
// ---------------------------------------------------------------------------

/**
 * Claims inside a callback token. Minted per call, or per install hook, and verified without a
 * store lookup. Tenant and manifest come from the install. Accepted only at the platform-methods
 * endpoint (`platformUrl`), never at `/api/*`.
 */
export type CallbackClaims = {
  installId: string;
  /** Null for the install-scoped token that `install` and `uninstall` hooks receive. */
  callId: string | null;
  /** Unix seconds. */
  exp: number;
};

export function verifyCallbackToken(signingKey: Sealed, bearer: string): CallbackClaims | null {
  throw new Error("not implemented");
}

// ---------------------------------------------------------------------------
// Layer 2 state: OAuth clients, connections and connects in progress.
// ---------------------------------------------------------------------------

/**
 * The provider OAuth client for one oauth2 credential of one app, set by an operator. Immutable
 * apart from `clientSecret`. A different `clientId` or different endpoints make a new binding with
 * a new `id`, so grants made under the old binding are never sent to the new endpoints.
 */
export type OAuthBinding = {
  id: string;
  clientId: string;
  /** Replaced in place on rotation of the same client. */
  clientSecret: Sealed;
  /** The manifest endpoints at the time the operator set this client. The platform calls only these. */
  pinned: { authorizeUrl: Endpoint; tokenUrl: Endpoint };
};

export type AppRecord = {
  name: string;
  url: string;
  manifest: Manifest;
  /** ADR 0008 platform-to-app signing key, issued at registration. */
  hmacSecret: Sealed;
  /** The current binding by credential name. No management endpoint returns these. */
  oauthBindings: Map<string, OAuthBinding>;
};

/**
 * A connected credential. Each write replaces the whole record, so comparing records by identity
 * detects a concurrent change.
 */
export type Connection =
  | {
      readonly type: "oauth2";
      /** The binding that issued these tokens. If the app's current binding differs, this reads as missing. */
      readonly bindingId: string;
      readonly accessToken: Sealed;
      readonly expiresAt: Date;
      /** Null if the provider issued none. The connection then ends at `expiresAt`. */
      readonly refreshToken: Sealed | null;
      /**
       * Token response fields other than `access_token`, `refresh_token` and `id_token`, kept as
       * returned. HubSpot's `hub_id` will route webhooks.
       */
      readonly providerFields: Readonly<Record<string, unknown>>;
    }
  | { readonly type: "apiKey"; readonly key: Sealed };

export type Install = {
  id: string;
  tenantId: string;
  app: string;
  config: Record<string, unknown>;
  /** By credential name. Uninstall deletes the install, and its connections go with it. */
  connections: Map<string, Connection>;
};

/** An OAuth connect in progress. Keyed by its `state` value and removed on first use. */
export type PendingConnect = {
  installId: string;
  credential: string;
  bindingId: string;
  /** The session that started the connect. Only that session may finish it. */
  sessionId: string;
  expiresAt: Date;
};

/** The provider's redirect query, parsed by the route. RFC 6749 section 4.1.2. */
export type CallbackQuery = { state: string } & ({ code: string } | { error: string });

/**
 * Each binding has its own redirect URI, `<platform base URL>/oauth/callback/<binding id>`. The
 * callback route takes the binding id from the path and checks it against the pending connect, so
 * a code issued by one provider cannot be redeemed at another binding's token URL (RFC 9700
 * section 4.4, mix-up attacks).
 */
export function redirectUriFor(store: Store, bindingId: string): string {
  throw new Error("not implemented");
}

/** In-memory platform state. */
export type Store = {
  /** The platform's public origin. Redirect URIs are derived from it per binding. */
  baseUrl: string;
  apps: Map<string, AppRecord>;
  installs: Map<string, Install>;
  pendingConnects: Map<string, PendingConnect>;
  /** Management tokens by SHA-256 hex. Seeded from config in the slice. */
  apiTokens: Map<string, Principal>;
  sessions: Map<string, Session>;
  /** ADR 0008 callback token signing key. Whoever holds it can read every connected credential. */
  callbackKey: Sealed;
  /** One in-flight refresh per connection record. Concurrent `credentials/get` calls await it. */
  refreshes: WeakMap<Connection, Promise<Connection>>;
};

export const CONNECT_TTL_MS = 10 * 60 * 1000;

/** `credentials/get` refreshes first when less than this remains on the access token. */
export const REFRESH_MARGIN_MS = 5 * 60 * 1000;

// ---------------------------------------------------------------------------
// Layer 2 operations. Management functions take a `Principal` and call `can` themselves.
// ---------------------------------------------------------------------------

/**
 * Set the provider OAuth client for one oauth2 credential and pin the endpoints the manifest
 * declares now. The same `clientId` and endpoints rotate the secret in place and keep the binding.
 * Anything else makes a new binding, and existing grants read as missing until each tenant
 * reconnects. Returns what the operator registers in the provider's app config.
 */
export function setOAuthClient(
  store: Store,
  principal: Principal,
  app: string,
  credential: string,
  client: { clientId: string; clientSecret: string },
): { redirectUri: string; authorizeUrl: Endpoint; tokenUrl: Endpoint; scopes: readonly string[] } {
  // TODO: can(principal, { type: "app.setOAuthClient", app }), else 403.
  // TODO: need = manifest.needs.credentials[credential]. Missing or not oauth2 → 404.
  // TODO: same clientId and pinned endpoints as the current binding → replace clientSecret only.
  //       Otherwise oauthBindings.set(credential, { id: new id, clientId, clientSecret: seal(...), pinned }).
  throw new Error("not implemented");
}

/**
 * Start an OAuth connect from a signed-in browser. Returns the provider URL the route redirects to.
 * The current connection, if any, keeps working until the new one is stored.
 */
export function beginOAuthConnect(
  store: Store,
  session: Session,
  installId: string,
  credential: string,
): { authorizeUrl: string } {
  // TODO: install, else 404. can(session.principal, { type: "install.connect", install }), else 403.
  // TODO: need is oauth2. A binding exists and `pinned` equals the need's endpoints, else 409
  //       "endpoints changed, an operator must set the OAuth client again".
  // TODO: state = 32 random bytes, base64url.
  //       pendingConnects.set(state, { installId, credential, bindingId, sessionId: session.id, expiresAt }).
  // TODO: pinned.authorizeUrl with response_type=code, client_id, redirect_uri, scope (joined by %20), state.
  throw new Error("not implemented");
}

/**
 * Handle the provider redirect to `redirectUriFor(bindingId)`. The browser must present the session
 * that began the connect, so a consent URL sent to someone else cannot attach their account to this
 * install.
 */
export async function finishOAuthConnect(
  store: Store,
  session: Session,
  bindingId: string,
  query: CallbackQuery,
): Promise<{ install: Install; credential: string }> {
  // TODO: take and delete pendingConnects[state]. Missing or expired → 400. `error` → 400 that names it.
  // TODO: pending.sessionId === session.id, else 403. The install still exists and
  //       can(session.principal, { type: "install.connect", install }) still holds, else 403.
  // TODO: bindingId from the path === pending.bindingId, else 400. The app's current binding id
  //       === pending.bindingId, else 409.
  // TODO: POST pinned.tokenUrl, form body: grant_type=authorization_code, code, redirect_uri,
  //       client_id, client_secret. Use `redirect: "error"` so a redirect cannot send the secret elsewhere.
  // TODO: install.connections.set(credential, oauth2 record with pending.bindingId and the parsed
  //       token response).
  throw new Error("not implemented");
}

/** Store the API key a tenant admin entered. Idempotent. */
export function connectApiKey(
  store: Store,
  principal: Principal,
  installId: string,
  credential: string,
  key: string,
): void {
  // TODO: install, else 404. can(principal, { type: "install.connect", install }), else 403.
  // TODO: need is apiKey, else 404. install.connections.set(credential, { type: "apiKey", key: seal(key) }).
  throw new Error("not implemented");
}

/**
 * `credentials/get`. The callback token picks the install. An oauth2 result stays valid for at
 * least REFRESH_MARGIN_MS, because the platform refreshes first when less remains.
 */
export async function getCredential(store: Store, claims: CallbackClaims, name: string): Promise<CredentialValue> {
  // TODO: need = manifest.needs.credentials[name], else NotDeclared.
  // TODO: connection with connection.type === need.type, and for oauth2 connection.bindingId equal to
  //       the app's current binding id, else CredentialMissing.
  // TODO: apiKey → { type, key }. Fresh oauth2 → { type, accessToken, expiresAt }.
  // TODO: stale oauth2 → one refresh at a time through store.refreshes:
  //       POST pinned.tokenUrl of the connection's binding, form body: grant_type=refresh_token,
  //       refresh_token, client_id, client_secret. Keep the old refresh token unless the response
  //       carries a new one. Write back only if the install still holds the record that was read.
  //       invalid_grant → delete the connection only if the install still holds the record that was
  //       read, then CredentialMissing. If a reconnect replaced it, return the new record instead.
  //       Other failures → InternalError, keep it.
  throw new Error("not implemented");
}
