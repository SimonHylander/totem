import { createHash } from "node:crypto";
import { ErrorCode, RpcError, type CredentialValue, type Endpoint, type OAuth2Need } from "@totem/protocol";
import { HttpError, authorize, type Principal, type Session } from "./access.js";
import { getApp, getInstall, manifestOf } from "./apps.js";
import type { CallbackClaims } from "./callback-token.js";
import { Sealed, randomToken, type Context, type Install, type OAuthBinding, type OAuthConnection } from "./store.js";

// Connector credentials (ADR 0009, ADR 0012). Tenants connect them, the platform stores and
// refreshes them, and `credentials/get` hands the current value to the app.

export const OAUTH_CALLBACK_PATH = "/oauth/callback";
const CONNECT_TTL_MS = 10 * 60 * 1000;
/** `credentials/get` refreshes first when less than this remains on the access token. */
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

/** Each provider has its own callback, so a code from one provider cannot reach another's token URL. */
export function redirectUriFor({ baseUrl }: Context, bindingId: string): string {
  return `${baseUrl}${OAUTH_CALLBACK_PATH}/${bindingId}`;
}

/**
 * Set the provider OAuth client for one oauth2 credential and pin the manifest's endpoints. The same
 * client ID and endpoints rotate the secret in place. Anything else makes a new binding, and existing
 * grants read as missing until each tenant reconnects. Returns what the operator registers at the provider.
 */
export function setOAuthClient(
  ctx: Context,
  principal: Principal,
  appId: string,
  name: string,
  client: { clientId: string; clientSecret: string },
): { redirectUri: string; authorizeUrl: Endpoint; tokenUrl: Endpoint; scopes: readonly string[] } {
  authorize(principal, { type: "app.setOAuthClient" });
  const app = getApp(ctx, appId);
  const need = app.manifest?.needs.credentials?.[name];
  if (need?.type !== "oauth2") throw new HttpError(404, `no oauth2 credential ${name}`);

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
  return { redirectUri: redirectUriFor(ctx, id), authorizeUrl, tokenUrl, scopes };
}

/**
 * Start an OAuth connect from a signed-in browser. Returns the provider URL to redirect to. The
 * current connection, if any, keeps working until the new one is stored.
 */
export function beginOAuthConnect(ctx: Context, session: Session, installId: string, name: string): string {
  const install = getInstall(ctx, installId);
  authorize(session.principal, { type: "install.connect", install });
  const { need, binding } = oauthBinding(ctx, install, name);

  const state = randomToken();
  ctx.store.pendingConnects.set(state, {
    installId,
    credential: name,
    binding,
    sessionId: session.id,
    expiresAt: new Date(Date.now() + CONNECT_TTL_MS),
  });
  const url = new URL(binding.pinned.authorizeUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", binding.clientId);
  url.searchParams.set("redirect_uri", redirectUriFor(ctx, binding.id));
  url.searchParams.set("scope", need.scopes.join(" "));
  url.searchParams.set("state", state);
  // URLSearchParams encodes spaces as "+". HubSpot documents scopes joined by "%20".
  url.search = url.searchParams.toString().replaceAll("+", "%20");
  return url.toString();
}

/** The provider's redirect query, parsed by the route. RFC 6749 section 4.1.2. */
export type CallbackQuery = { state: string } & ({ code: string } | { error: string });

/**
 * Handle the provider redirect to a binding's callback. The browser must present the session that
 * began the connect, so a consent URL sent to someone else cannot attach their account here.
 */
export async function finishOAuthConnect(
  ctx: Context,
  session: Session,
  bindingId: string,
  query: CallbackQuery,
): Promise<{ install: Install; credential: string }> {
  const pending = ctx.store.pendingConnects.get(query.state);
  ctx.store.pendingConnects.delete(query.state);
  if (!pending || pending.expiresAt.getTime() <= Date.now()) throw new HttpError(400, "unknown or expired connect");
  if (pending.sessionId !== session.id) throw new HttpError(403, "this connect was started by another session");
  if (pending.binding.id !== bindingId) throw new HttpError(400, "callback does not match the connect's OAuth client");
  if ("error" in query) throw new HttpError(400, `the provider returned ${query.error}`);

  const install = getInstall(ctx, pending.installId);
  authorize(session.principal, { type: "install.connect", install });
  const { binding } = oauthBinding(ctx, install, pending.credential);
  if (binding !== pending.binding) throw new HttpError(409, "the OAuth client changed during the connect");

  const response = await tokenRequest(ctx, binding, {
    grant_type: "authorization_code",
    code: query.code,
    redirect_uri: redirectUriFor(ctx, binding.id),
  });
  if (!response.ok) throw new HttpError(502, `token exchange failed with ${response.status}`);
  install.connections.set(pending.credential, toConnection(binding, await response.json(), null));
  return { install, credential: pending.credential };
}

/** Store the API key a tenant admin entered. Idempotent. */
export function connectApiKey(ctx: Context, principal: Principal, installId: string, name: string, key: string): void {
  const install = getInstall(ctx, installId);
  authorize(principal, { type: "install.connect", install });
  if (manifestOf(ctx, install).needs.credentials?.[name]?.type !== "apiKey") {
    throw new HttpError(404, `no apiKey credential ${name}`);
  }
  install.connections.set(name, { type: "apiKey", key: new Sealed(key) });
}

/**
 * `credentials/get`. The callback token picks the install. An oauth2 result stays valid for at
 * least REFRESH_MARGIN_MS, because the platform refreshes first when less remains.
 */
export async function getCredential(ctx: Context, claims: CallbackClaims, name: string): Promise<CredentialValue> {
  const install = getInstall(ctx, claims.installId);
  const need = manifestOf(ctx, install).needs.credentials?.[name];
  if (!need) throw new RpcError(ErrorCode.NotDeclared, `credential "${name}" is not declared in the manifest`);

  const missing = new RpcError(ErrorCode.CredentialMissing, `credential "${name}" is not connected`);
  const connection = install.connections.get(name);
  if (connection?.type === "apiKey" && need.type === "apiKey") return { type: "apiKey", key: connection.key.reveal() };
  if (connection?.type !== "oauth2" || need.type !== "oauth2") throw missing;

  const binding = getApp(ctx, install.appId).oauthBindings.get(name);
  if (connection.binding !== binding) throw missing;

  const fresh = connection.expiresAt.getTime() - Date.now() > REFRESH_MARGIN_MS ? connection : await refresh(ctx, install, name, binding, connection);
  if (!fresh) throw missing;
  return { type: "oauth2", accessToken: fresh.accessToken.reveal(), expiresAt: fresh.expiresAt.toISOString() };
}

/** One refresh per connection record at a time. Null when the grant is gone. */
function refresh(
  ctx: Context,
  install: Install,
  name: string,
  binding: OAuthBinding,
  connection: OAuthConnection,
): Promise<OAuthConnection | null> {
  const inFlight = ctx.store.refreshes.get(connection);
  if (inFlight) return inFlight;

  const run = async (): Promise<OAuthConnection | null> => {
    // Without a refresh token the connection ends at expiresAt.
    if (!connection.refreshToken) return connection.expiresAt.getTime() > Date.now() ? connection : null;

    const response = await tokenRequest(ctx, binding, {
      grant_type: "refresh_token",
      refresh_token: connection.refreshToken.reveal(),
    });
    // Every write, including the delete, applies only if no reconnect replaced the record we read.
    const current = install.connections.get(name);
    const replaced = current !== connection;
    if (response.status === 400 && (await errorCode(response)) === "invalid_grant") {
      if (replaced) return current?.type === "oauth2" ? current : null;
      install.connections.delete(name);
      return null;
    }
    if (!response.ok) throw new RpcError(ErrorCode.InternalError, `token refresh failed with ${response.status}`);
    const refreshed = toConnection(binding, await response.json(), connection.refreshToken);
    if (replaced) return current?.type === "oauth2" ? current : null;
    install.connections.set(name, refreshed);
    return refreshed;
  };

  const promise = run().finally(() => ctx.store.refreshes.delete(connection));
  ctx.store.refreshes.set(connection, promise);
  return promise;
}

/** The current binding for an oauth2 credential, checked against the manifest's endpoints. */
function oauthBinding(ctx: Context, install: Install, name: string): { need: OAuth2Need; binding: OAuthBinding } {
  const need = manifestOf(ctx, install).needs.credentials?.[name];
  if (need?.type !== "oauth2") throw new HttpError(404, `no oauth2 credential ${name}`);
  const binding = getApp(ctx, install.appId).oauthBindings.get(name);
  if (!binding) throw new HttpError(409, `no OAuth client set for ${name}. An operator must set one.`);
  if (binding.pinned.authorizeUrl !== need.authorizeUrl || binding.pinned.tokenUrl !== need.tokenUrl) {
    throw new HttpError(409, `the endpoints for ${name} changed. An operator must set the OAuth client again.`);
  }
  return { need, binding };
}

/**
 * POST to the pinned token URL with the client credentials in the form body (client_secret_post).
 * Redirects are refused, so a redirect cannot carry the secret elsewhere.
 */
function tokenRequest(ctx: Context, binding: OAuthBinding, params: Record<string, string>): Promise<Response> {
  return ctx.fetch(binding.pinned.tokenUrl, {
    method: "POST",
    redirect: "error",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({
      ...params,
      client_id: binding.clientId,
      client_secret: binding.clientSecret.reveal(),
    }),
  });
}

async function errorCode(response: Response): Promise<unknown> {
  try {
    return ((await response.json()) as { error?: unknown }).error;
  } catch {
    return undefined;
  }
}

/** Parse a token response (RFC 6749 section 5.1). Keeps the old refresh token when none is returned. */
function toConnection(binding: OAuthBinding, body: unknown, previousRefresh: Sealed | null): OAuthConnection {
  const { access_token, refresh_token, expires_in, id_token: _idToken, ...providerFields } = body as Record<string, unknown>;
  if (typeof access_token !== "string" || typeof expires_in !== "number") {
    throw new HttpError(502, "the token response has no access_token or expires_in");
  }
  return {
    type: "oauth2",
    binding,
    accessToken: new Sealed(access_token),
    expiresAt: new Date(Date.now() + expires_in * 1000),
    refreshToken: typeof refresh_token === "string" ? new Sealed(refresh_token) : previousRefresh,
    providerFields,
  };
}
