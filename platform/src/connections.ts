import { createHash } from "node:crypto";
import type { CredentialStatus, CredentialValue } from "@totem/protocol";
import { DateTime, Deferred, Effect } from "effect";
import { FetchHttpClient } from "effect/http";
import { authorize, type Principal, type Session } from "./access.js";
import { getApp, getInstall, manifestOf } from "./apps.js";
import type { CallbackClaims } from "./callback-token.js";
import { BadRequest, Conflict, CredentialMissing, Forbidden, NotDeclared, NotFound, ProviderFailed } from "./errors.js";
import {
  PlatformConfig,
  Sealed,
  Store,
  randomToken,
  type Install,
  type OAuthBinding,
  type OAuthConnection,
  type PendingConnect,
} from "./store.js";

// Connector credentials (ADR 0009, ADR 0012). Tenants connect them, the platform stores and
// refreshes them, and `credentials/get` hands the current value to the app.

export const OAUTH_CALLBACK_PATH = "/oauth/callback";
const CONNECT_TTL = { minutes: 10 };
/** `credentials/get` refreshes first when less than this remains on the access token. */
const REFRESH_MARGIN = { minutes: 5 };

/** Each provider has its own callback, so a code from one provider cannot reach another's token URL. */
export const redirectUriFor = (bindingId: string) =>
  PlatformConfig.useSync(({ baseUrl }) => `${baseUrl}${OAUTH_CALLBACK_PATH}/${bindingId}`);

/**
 * Set the provider OAuth client for one oauth2 credential and pin the manifest's endpoints. The same
 * client ID and endpoints rotate the secret in place. Anything else makes a new binding, and existing
 * grants read as missing until each tenant reconnects. Returns what the operator registers at the provider.
 */
export const setOAuthClient = Effect.fnUntraced(function* (
  principal: Principal,
  appId: string,
  name: string,
  client: { clientId: string; clientSecret: string },
) {
  yield* authorize(principal, { type: "app.setOAuthClient" });
  const app = yield* getApp(appId);
  const need = app.manifest?.needs.credentials?.[name];
  if (need?.type !== "oauth2") return yield* new NotFound({ message: `no oauth2 credential ${name}` });

  const { authorizeUrl, tokenUrl, scopes } = need;
  const id = createHash("sha256").update(JSON.stringify([authorizeUrl, tokenUrl])).digest("base64url").slice(0, 22);
  const current = app.oauthBindings.get(name);
  if (current?.id === id && current.clientId === client.clientId) current.clientSecret = new Sealed(client.clientSecret);
  else {
    app.oauthBindings.set(name, {
      id,
      clientId: client.clientId,
      clientSecret: new Sealed(client.clientSecret),
      pinned: { authorizeUrl, tokenUrl },
    });
  }
  return { redirectUri: yield* redirectUriFor(id), authorizeUrl, tokenUrl, scopes };
});

/**
 * Start an OAuth connect from a signed-in browser. Returns the provider URL to redirect to. The
 * current connection, if any, keeps working until the new one is stored.
 */
export const beginOAuthConnect = Effect.fnUntraced(function* (session: Session, installId: string, name: string) {
  const install = yield* getInstall(installId);
  yield* authorize(session.principal, { type: "install.connect", install });
  return yield* startOAuthConnect(install, name, { sessionId: session.id, returnTo: null });
});

/**
 * Record a pending connect and return the provider's authorize URL. `sessionId` null means an app
 * started it through `ports/connect` (ADR 0015).
 */
export const startOAuthConnect = Effect.fnUntraced(function* (
  install: Install,
  name: string,
  owner: Pick<PendingConnect, "sessionId" | "returnTo">,
) {
  const { need, binding } = yield* oauthBinding(install, name);

  const state = randomToken();
  (yield* Store).pendingConnects.set(state, {
    installId: install.id,
    credential: name,
    binding,
    ...owner,
    expiresAt: DateTime.add(yield* DateTime.now, CONNECT_TTL),
  });
  const url = new URL(binding.pinned.authorizeUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", binding.clientId);
  url.searchParams.set("redirect_uri", yield* redirectUriFor(binding.id));
  url.searchParams.set("scope", need.scopes.join(" "));
  url.searchParams.set("state", state);
  // URLSearchParams encodes spaces as "+". HubSpot documents scopes joined by "%20".
  url.search = url.searchParams.toString().replaceAll("+", "%20");
  return url.toString();
});

/** The provider's redirect query, parsed by the route. RFC 6749 section 4.1.2. */
export type CallbackQuery = { state: string } & ({ code: string } | { error: string });

/**
 * Handle the provider redirect to a binding's callback. A connect begun on the platform needs the
 * browser to present the session that began it, so a consent URL sent to someone else cannot attach
 * their account here. A connect an app began needs no session (ADR 0015).
 */
export const finishOAuthConnect = Effect.fnUntraced(function* (
  session: Session | null,
  bindingId: string,
  query: CallbackQuery,
) {
  const store = yield* Store;
  const pending = store.pendingConnects.get(query.state);
  store.pendingConnects.delete(query.state);
  if (!pending || DateTime.isLessThanOrEqualTo(pending.expiresAt, yield* DateTime.now)) {
    return yield* new BadRequest({ message: "unknown or expired connect" });
  }
  if (pending.sessionId !== null && pending.sessionId !== session?.id) {
    return yield* new Forbidden({ message: "this connect was started by another session" });
  }
  if (pending.binding.id !== bindingId) {
    return yield* new BadRequest({ message: "callback does not match the connect's OAuth client" });
  }
  if ("error" in query) return yield* new BadRequest({ message: `the provider returned ${query.error}` });

  const install = yield* getInstall(pending.installId);
  if (session && pending.sessionId !== null) yield* authorize(session.principal, { type: "install.connect", install });
  const { binding } = yield* oauthBinding(install, pending.credential);
  if (binding !== pending.binding) return yield* new Conflict({ message: "the OAuth client changed during the connect" });

  const response = yield* tokenRequest(binding, {
    grant_type: "authorization_code",
    code: query.code,
    redirect_uri: yield* redirectUriFor(binding.id),
  });
  if (!response.ok) return yield* new ProviderFailed({ message: `token exchange failed with ${response.status}` });
  install.connections.set(pending.credential, yield* toConnection(binding, yield* json(response), null));
  return { install, credential: pending.credential, returnTo: pending.returnTo };
});

/** Each of an install's `needs.credentials`, and whether `credentials/get` would find it connected now. */
export const credentialStatus = Effect.fnUntraced(function* (install: Install) {
  const { oauthBindings } = yield* getApp(install.appId);
  const status: Record<string, CredentialStatus> = {};
  for (const [name, need] of Object.entries((yield* manifestOf(install)).needs.credentials ?? {})) {
    const connection = install.connections.get(name);
    const connected =
      connection?.type === "oauth2" ? connection.binding === oauthBindings.get(name) : connection?.type === need.type;
    status[name] = { type: need.type, connected };
  }
  return status;
});

/** Store the API key a tenant admin entered. Idempotent. */
export const connectApiKey = Effect.fnUntraced(function* (
  principal: Principal,
  installId: string,
  name: string,
  key: string,
) {
  const install = yield* getInstall(installId);
  yield* authorize(principal, { type: "install.connect", install });
  if ((yield* manifestOf(install)).needs.credentials?.[name]?.type !== "apiKey") {
    return yield* new NotFound({ message: `no apiKey credential ${name}` });
  }
  install.connections.set(name, { type: "apiKey", key: new Sealed(key) });
});

/**
 * `credentials/get`. The callback token picks the install. An oauth2 result stays valid for at
 * least REFRESH_MARGIN, because the platform refreshes first when less remains.
 */
export const getCredential = Effect.fnUntraced(function* (claims: CallbackClaims, name: string) {
  const install = yield* getInstall(claims.installId);
  const need = (yield* manifestOf(install)).needs.credentials?.[name];
  if (!need) return yield* new NotDeclared({ message: `credential "${name}" is not declared in the manifest` });

  const missing = new CredentialMissing({ message: `credential "${name}" is not connected` });
  const connection = install.connections.get(name);
  if (connection?.type === "apiKey" && need.type === "apiKey") {
    return { type: "apiKey", key: connection.key.reveal() } satisfies CredentialValue;
  }
  if (connection?.type !== "oauth2" || need.type !== "oauth2") return yield* missing;

  const binding = (yield* getApp(install.appId)).oauthBindings.get(name);
  if (connection.binding !== binding) return yield* missing;

  const stale = DateTime.isLessThanOrEqualTo(connection.expiresAt, DateTime.add(yield* DateTime.now, REFRESH_MARGIN));
  const fresh = stale ? yield* refresh(install, name, binding, connection) : connection;
  if (!fresh) return yield* missing;
  return {
    type: "oauth2",
    accessToken: fresh.accessToken.reveal(),
    expiresAt: DateTime.formatIso(fresh.expiresAt),
  } satisfies CredentialValue;
});

/** One refresh per connection record at a time. Concurrent callers await the same Deferred. Null when the grant is gone. */
const refresh = Effect.fnUntraced(function* (
  install: Install,
  name: string,
  binding: OAuthBinding,
  connection: OAuthConnection,
) {
  const { refreshes } = yield* Store;
  const inFlight = refreshes.get(connection);
  if (inFlight) return yield* Deferred.await(inFlight);

  const deferred = Deferred.makeUnsafe<OAuthConnection | null, ProviderFailed>();
  refreshes.set(connection, deferred);
  yield* Deferred.into(refreshOnce(install, name, binding, connection), deferred).pipe(
    Effect.ensuring(Effect.sync(() => refreshes.delete(connection))),
  );
  return yield* Deferred.await(deferred);
});

const refreshOnce = Effect.fnUntraced(function* (
  install: Install,
  name: string,
  binding: OAuthBinding,
  connection: OAuthConnection,
) {
  // Without a refresh token the connection ends at expiresAt.
  if (!connection.refreshToken) return (yield* DateTime.isPast(connection.expiresAt)) ? null : connection;

  const response = yield* tokenRequest(binding, {
    grant_type: "refresh_token",
    refresh_token: connection.refreshToken.reveal(),
  });
  // Every write, including the delete, applies only if no reconnect replaced the record we read.
  const current = install.connections.get(name);
  const replaced = current !== connection;
  const currentOrNull = current?.type === "oauth2" ? current : null;
  if (response.status === 400 && (yield* errorCode(response)) === "invalid_grant") {
    if (replaced) return currentOrNull;
    install.connections.delete(name);
    return null;
  }
  if (!response.ok) return yield* new ProviderFailed({ message: `token refresh failed with ${response.status}` });
  const refreshed = yield* toConnection(binding, yield* json(response), connection.refreshToken);
  if (replaced) return currentOrNull;
  install.connections.set(name, refreshed);
  return refreshed;
});

/** The current binding for an oauth2 credential, checked against the manifest's endpoints. */
const oauthBinding = Effect.fnUntraced(function* (install: Install, name: string) {
  const need = (yield* manifestOf(install)).needs.credentials?.[name];
  if (need?.type !== "oauth2") return yield* new NotFound({ message: `no oauth2 credential ${name}` });
  const binding = (yield* getApp(install.appId)).oauthBindings.get(name);
  if (!binding) return yield* new Conflict({ message: `no OAuth client set for ${name}. An operator must set one.` });
  if (binding.pinned.authorizeUrl !== need.authorizeUrl || binding.pinned.tokenUrl !== need.tokenUrl) {
    return yield* new Conflict({ message: `the endpoints for ${name} changed. An operator must set the OAuth client again.` });
  }
  return { need, binding };
});

/**
 * POST to the pinned token URL with the client credentials in the form body (client_secret_post).
 * Redirects are refused, so a redirect cannot carry the secret elsewhere.
 */
const tokenRequest = Effect.fnUntraced(function* (binding: OAuthBinding, params: Record<string, string>) {
  const fetch = yield* FetchHttpClient.Fetch;
  return yield* Effect.tryPromise({
    try: () =>
      fetch(binding.pinned.tokenUrl, {
        method: "POST",
        redirect: "error",
        headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
        body: new URLSearchParams({
          ...params,
          client_id: binding.clientId,
          client_secret: binding.clientSecret.reveal(),
        }),
      }),
    catch: () => new ProviderFailed({ message: "the token endpoint is unreachable" }),
  });
});

const json = (response: Response) =>
  Effect.tryPromise({
    try: (): Promise<unknown> => response.json(),
    catch: () => new ProviderFailed({ message: "the token response is not JSON" }),
  });

const errorCode = (response: Response) =>
  json(response).pipe(
    Effect.map((body) => (typeof body === "object" && body !== null && "error" in body ? body.error : undefined)),
    Effect.orElseSucceed(() => undefined),
  );

/** Parse a token response (RFC 6749 section 5.1). Keeps the old refresh token when none is returned. */
const toConnection = Effect.fnUntraced(function* (binding: OAuthBinding, body: unknown, previousRefresh: Sealed | null) {
  const { access_token, refresh_token, expires_in, id_token: _idToken, ...providerFields } = body as Record<string, unknown>;
  if (typeof access_token !== "string" || typeof expires_in !== "number") {
    return yield* new ProviderFailed({ message: "the token response has no access_token or expires_in" });
  }
  const connection: OAuthConnection = {
    type: "oauth2",
    binding,
    accessToken: new Sealed(access_token),
    expiresAt: DateTime.add(yield* DateTime.now, { seconds: expires_in }),
    refreshToken: typeof refresh_token === "string" ? new Sealed(refresh_token) : previousRefresh,
    providerFields,
  };
  return connection;
});
