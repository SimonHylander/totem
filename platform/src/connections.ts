import { createHash } from "node:crypto";
import type { AppId, InstallId } from "@totem/ids";
import type { CredentialStatus, CredentialValue } from "@totem/protocol";
import { DateTime, Deferred, Effect, Option, Schema } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";
import { authorize, type Authorized } from "@totem/permissions";
import type { InstallAction, Session } from "./access.js";
import { manifestOf } from "./apps.js";
import type { CallbackClaims } from "./callback-token.js";
import { BadRequest, Conflict, CredentialMissing, Forbidden, NotDeclared, NotFound, ProviderFailed } from "./errors.js";
import {
  PlatformConfig,
  Sealed,
  Store,
  randomToken,
  withEntry,
  type Connection,
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
  _: Authorized<{ type: "app.setOAuthClient" }>,
  appId: AppId,
  name: string,
  client: { clientId: string; clientSecret: string },
) {
  const { apps } = yield* Store;
  const app = yield* apps.get(appId);
  const need = app.manifest?.needs.credentials?.[name];
  if (need?.type !== "oauth2") return yield* new NotFound({ message: `no oauth2 credential ${name}` });

  const { authorizeUrl, tokenUrl, scopes } = need;
  const id = createHash("sha256").update(JSON.stringify([authorizeUrl, tokenUrl])).digest("base64url").slice(0, 22);
  const current = app.oauthBindings.get(name);
  if (current?.id === id && current.clientId === client.clientId) current.clientSecret = new Sealed(client.clientSecret);
  else {
    const binding: OAuthBinding = {
      id,
      clientId: client.clientId,
      clientSecret: new Sealed(client.clientSecret),
      pinned: { authorizeUrl, tokenUrl },
    };
    yield* apps.update(appId, (app) => ({ ...app, oauthBindings: withEntry(app.oauthBindings, name, binding) }));
  }
  return { redirectUri: yield* redirectUriFor(id), authorizeUrl, tokenUrl, scopes };
});

/**
 * Start an OAuth connect from a signed-in browser. Returns the provider URL to redirect to. The
 * current connection, if any, keeps working until the new one is stored.
 */
export const beginOAuthConnect = Effect.fnUntraced(function* (
  session: Session,
  { action: { install } }: Authorized<InstallAction<"install.connect">>,
  name: string,
) {
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
  yield* (yield* Store).pendingConnects.put({
    state,
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
  const pending = yield* store.pendingConnects.take(query.state);
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

  const install = yield* store.installs.get(pending.installId);
  if (session && pending.sessionId !== null) yield* Effect.fromResult(authorize(session.principal, { type: "install.connect", install }));
  const { binding } = yield* oauthBinding(install, pending.credential);
  if (binding !== pending.binding) return yield* new Conflict({ message: "the OAuth client changed during the connect" });

  const body = yield* tokenRequest(binding, {
    grant_type: "authorization_code",
    code: query.code,
    redirect_uri: yield* redirectUriFor(binding.id),
  });
  if (body === "invalid_grant") return yield* new ProviderFailed({ message: "the provider refused the code" });
  yield* setConnection(install.id, pending.credential, yield* toConnection(binding, body, null));
  return { install, credential: pending.credential, returnTo: pending.returnTo };
});

/** Each of an install's `needs.credentials`, and whether `credentials/get` would find it connected now. */
export const credentialStatus = Effect.fnUntraced(function* (install: Install) {
  const { oauthBindings } = yield* (yield* Store).apps.get(install.appId);
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
  { action: { install } }: Authorized<InstallAction<"install.connect">>,
  name: string,
  key: string,
) {
  if ((yield* manifestOf(install)).needs.credentials?.[name]?.type !== "apiKey") {
    return yield* new NotFound({ message: `no apiKey credential ${name}` });
  }
  yield* setConnection(install.id, name, { type: "apiKey", key: new Sealed(key) });
});

const setConnection = (installId: InstallId, name: string, connection: Connection) =>
  Store.use(({ installs }) =>
    installs.update(installId, (install) => ({ ...install, connections: withEntry(install.connections, name, connection) })),
  );

/**
 * `credentials/get`. The callback token picks the install. An oauth2 result stays valid for at
 * least REFRESH_MARGIN, because the platform refreshes first when less remains.
 */
export const getCredential = Effect.fnUntraced(function* (claims: CallbackClaims, name: string) {
  const { apps, installs } = yield* Store;
  const install = yield* installs.get(claims.installId);
  const need = (yield* manifestOf(install)).needs.credentials?.[name];
  if (!need) return yield* new NotDeclared({ message: `credential "${name}" is not declared in the manifest` });

  const missing = new CredentialMissing({ message: `credential "${name}" is not connected` });
  const connection = install.connections.get(name);
  if (connection?.type === "apiKey" && need.type === "apiKey") {
    return { type: "apiKey", key: connection.key.reveal() } satisfies CredentialValue;
  }
  if (connection?.type !== "oauth2" || need.type !== "oauth2") return yield* missing;

  const binding = (yield* apps.get(install.appId)).oauthBindings.get(name);
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

  const body = yield* tokenRequest(binding, {
    grant_type: "refresh_token",
    refresh_token: connection.refreshToken.reveal(),
  });
  const refreshed = body === "invalid_grant" ? undefined : yield* toConnection(binding, body, connection.refreshToken);

  // The write, including the delete, applies only if no reconnect replaced the record we read.
  // A reconnect's record wins. An install deleted meanwhile has no grant left.
  return yield* (yield* Store).installs.modify(install.id, (current) => {
    const stored = current.connections.get(name);
    if (stored !== connection) return [stored?.type === "oauth2" ? stored : null, current];
    return [refreshed ?? null, { ...current, connections: withEntry(current.connections, name, refreshed) }];
  }).pipe(Effect.catchTag("NotFound", () => Effect.succeed(null)));
});

/** The current binding for an oauth2 credential, checked against the manifest's endpoints. */
const oauthBinding = Effect.fnUntraced(function* (install: Install, name: string) {
  const need = (yield* manifestOf(install)).needs.credentials?.[name];
  if (need?.type !== "oauth2") return yield* new NotFound({ message: `no oauth2 credential ${name}` });
  const binding = (yield* (yield* Store).apps.get(install.appId)).oauthBindings.get(name);
  if (!binding) return yield* new Conflict({ message: `no OAuth client set for ${name}. An operator must set one.` });
  if (binding.pinned.authorizeUrl !== need.authorizeUrl || binding.pinned.tokenUrl !== need.tokenUrl) {
    return yield* new Conflict({ message: `the endpoints for ${name} changed. An operator must set the OAuth client again.` });
  }
  return { need, binding };
});

const TOKEN_TIMEOUT = "10 seconds";
const JsonObject = Schema.Record(Schema.String, Schema.Unknown);
const TokenError = Schema.Struct({ error: Schema.String });
/** RFC 6749 section 5.1. The other fields of the response are kept as `providerFields`. */
const TokenFields = Schema.Struct({
  access_token: Schema.String,
  expires_in: Schema.Number,
  refresh_token: Schema.optionalKey(Schema.String),
});

/**
 * POST to the pinned token URL with the client credentials in the form body (client_secret_post).
 * Redirects are refused, so a redirect cannot carry the secret elsewhere. Answers the response body,
 * or "invalid_grant" when the provider refused the grant. Every other failure is ProviderFailed.
 */
const tokenRequest = Effect.fnUntraced(function* (binding: OAuthBinding, params: Record<string, string>) {
  const client = yield* HttpClient.HttpClient;
  const response = yield* HttpClientRequest.post(binding.pinned.tokenUrl).pipe(
    HttpClientRequest.acceptJson,
    HttpClientRequest.bodyUrlParams({ ...params, client_id: binding.clientId, client_secret: binding.clientSecret.reveal() }),
    client.execute,
    Effect.timeout(TOKEN_TIMEOUT),
    Effect.provideService(FetchHttpClient.RequestInit, { redirect: "error" }),
    // HttpClient's own span would record the URL and send a traceparent to a third party. This span
    // records only the host (ADR 0016).
    Effect.provideService(HttpClient.TracerDisabledWhen, () => true),
    Effect.withSpan("oauth token", {
      kind: "client",
      attributes: { "server.address": new URL(binding.pinned.tokenUrl).host, "oauth.grant_type": params["grant_type"] },
    }),
    Effect.mapError(() => new ProviderFailed({ message: "the token endpoint is unreachable" })),
  );
  if (response.status === 400) {
    const refused = yield* HttpClientResponse.schemaBodyJson(TokenError)(response).pipe(Effect.option);
    if (Option.isSome(refused) && refused.value.error === "invalid_grant") return "invalid_grant" as const;
  }
  if (response.status < 200 || response.status >= 300) {
    return yield* new ProviderFailed({ message: `the token endpoint answered ${response.status}` });
  }
  return yield* HttpClientResponse.schemaBodyJson(JsonObject)(response).pipe(
    Effect.mapError(() => new ProviderFailed({ message: "the token response is not a JSON object" })),
  );
});

/** Parse a token response. Keeps the old refresh token when none is returned. */
const toConnection = Effect.fnUntraced(function* (
  binding: OAuthBinding,
  body: Readonly<Record<string, unknown>>,
  previousRefresh: Sealed | null,
) {
  const tokens = yield* Schema.decodeUnknownEffect(TokenFields)(body).pipe(
    Effect.mapError(() => new ProviderFailed({ message: "the token response has no access_token or expires_in" })),
  );
  const { access_token: _access, refresh_token: _refresh, expires_in: _expires, id_token: _id, ...providerFields } = body;
  const connection: OAuthConnection = {
    type: "oauth2",
    binding,
    accessToken: new Sealed(tokens.access_token),
    expiresAt: DateTime.add(yield* DateTime.now, { seconds: tokens.expires_in }),
    refreshToken: tokens.refresh_token !== undefined ? new Sealed(tokens.refresh_token) : previousRefresh,
    providerFields,
  };
  return connection;
});
