import { createHash } from "node:crypto";
import type { AppId, InstallId } from "@totem/ids";
import type { CredentialNeed, CredentialStatus, CredentialValue, Endpoint } from "@totem/protocol";
import { Context, DateTime, Deferred, Effect, Layer, Option, Ref, Schema } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";
import { authorize, type Authorized } from "@totem/permissions";
import type { InstallAction, Session } from "../access/access.js";
import { BadRequest, Conflict, CredentialMissing, Forbidden, NotDeclared, NotFound, ProviderFailed } from "../errors.js";
import { Installs, type Install } from "../installs/installs.js";
import { Apps } from "../apps/apps.js";
import { oauthCallbackPath } from "../http/paths.js";
import { PlatformConfig } from "../config.js";
import { Sealed, randomToken } from "../secrets.js";
import { withEntry } from "../table.js";

const CONNECT_TTL = { minutes: 10 };
const REFRESH_MARGIN = { minutes: 5 };

export type OAuthBinding = {
  /**
   * Names the redirect URI. Derived from the endpoints, so the URI survives a restart and can be
   * registered at the provider ahead of time. Two bindings for one provider share it.
   */
  readonly id: string;
  readonly generation: string;
  readonly clientId: string;
  readonly clientSecret: Sealed;
  readonly pinned: { readonly authorizeUrl: Endpoint; readonly tokenUrl: Endpoint };
};

/**
 * A connected credential. Each write replaces the whole record, so comparing records by identity
 * detects a concurrent change.
 */
export type Connection =
  | {
      readonly type: "oauth2";
      readonly generation: string;
      readonly accessToken: Sealed;
      readonly expiresAt: DateTime.Utc;
      readonly refreshToken: Sealed | null;
      readonly providerFields: Readonly<Record<string, unknown>>;
    }
  | { readonly type: "apiKey"; readonly key: Sealed };

export type OAuthConnection = Extract<Connection, { type: "oauth2" }>;

type PendingConnect = {
  readonly installId: InstallId;
  readonly credential: string;
  readonly bindingId: string;
  readonly generation: string;
  /**
   * Only the session that started the connect may finish it. Null when an app started it through
   * `ports/connect`, because the app, not the platform, knows who the user is (ADR 0015).
   */
  readonly sessionId: string | null;
  /** Where the callback redirects. Null shows the platform's own "Connected" page. */
  readonly returnTo: string | null;
  readonly expiresAt: DateTime.Utc;
};

type ConnectOwner = Pick<PendingConnect, "sessionId" | "returnTo">;

export type CallbackQuery = { state: string } & ({ code: string } | { error: string });

export class Connections extends Context.Service<
  Connections,
  {
    /**
     * Set the provider OAuth client for one oauth2 credential and pin the manifest's endpoints. The
     * same client ID and endpoints rotate the secret. Anything else starts a new generation, and
     * existing grants read as missing until each tenant reconnects. Returns what the operator
     * registers at the provider.
     */
    readonly setOAuthClient: (
      auth: Authorized<{ type: "app.setOAuthClient" }>,
      appId: AppId,
      name: string,
      client: { clientId: string; clientSecret: string },
    ) => Effect.Effect<{ redirectUri: string; authorizeUrl: Endpoint; tokenUrl: Endpoint; scopes: ReadonlyArray<string> }, NotFound>;
    /**
     * Start an OAuth connect and return the provider URL to redirect to. The current connection, if
     * any, keeps working until the new one is stored.
     */
    readonly beginOAuthConnect: (install: Install, name: string, owner: ConnectOwner) => Effect.Effect<string, NotFound | Conflict>;
    /**
     * Handle the provider redirect to a binding's callback. A connect begun on the platform needs the
     * browser to present the session that began it, so a consent URL sent to someone else cannot
     * attach their account here. A connect an app began needs no session (ADR 0015).
     */
    readonly finishOAuthConnect: (
      session: Session | null,
      bindingId: string,
      query: CallbackQuery,
    ) => Effect.Effect<
      { install: Install; credential: string; returnTo: string | null },
      BadRequest | Forbidden | NotFound | Conflict | ProviderFailed
    >;
    /** Store the API key a tenant admin entered. Idempotent. */
    readonly connectApiKey: (auth: Authorized<InstallAction<"install.connect">>, name: string, key: string) => Effect.Effect<void, NotFound>;
    /** Each of an install's `needs.credentials`, and whether `credentials/get` would find it connected now. */
    readonly status: (install: Install) => Effect.Effect<Record<string, CredentialStatus>>;
    /**
     * `credentials/get`. An oauth2 result stays valid for at least REFRESH_MARGIN, because the
     * platform refreshes first when less remains.
     */
    readonly get: (
      installId: InstallId,
      name: string,
    ) => Effect.Effect<CredentialValue, NotFound | NotDeclared | CredentialMissing | ProviderFailed>;
  }
>()("@totem/platform/Connections") {
  static readonly layer = Layer.effect(
    Connections,
    Effect.gen(function* () {
      const apps = yield* Apps;
      const installs = yield* Installs;
      const { baseUrl } = yield* PlatformConfig;
      const http = yield* HttpClient.HttpClient;

      const clients = yield* Ref.make<ReadonlyMap<AppId, ReadonlyMap<string, OAuthBinding>>>(new Map());
      const pending = yield* Ref.make<ReadonlyMap<string, PendingConnect>>(new Map());
      const refreshes = new WeakMap<OAuthConnection, Deferred.Deferred<OAuthConnection | null, ProviderFailed>>();

      /** Each provider has its own callback, so a code from one provider cannot reach another's token URL. */
      const redirectUriFor = (bindingId: string) => baseUrl + oauthCallbackPath(bindingId);

      const clientOf = (appId: AppId, name: string) => Effect.map(Ref.get(clients), (all) => all.get(appId)?.get(name));

      const oauthBinding = Effect.fnUntraced(function* (install: Install, name: string) {
        const need = install.version.manifest.needs.credentials?.[name];
        if (need?.type !== "oauth2") return yield* new NotFound({ message: `no oauth2 credential ${name}` });
        const binding = yield* clientOf(install.appId, name);
        if (!binding) return yield* new Conflict({ message: `no OAuth client set for ${name}. An operator must set one.` });
        if (binding.pinned.authorizeUrl !== need.authorizeUrl || binding.pinned.tokenUrl !== need.tokenUrl) {
          return yield* new Conflict({ message: `the endpoints for ${name} changed. An operator must set the OAuth client again.` });
        }
        return { need, binding };
      });

      /**
       * POST to the pinned token URL with the client credentials in the form body (client_secret_post).
       * Redirects are refused, so a redirect cannot carry the secret elsewhere. Answers the response
       * body, or "invalid_grant" when the provider refused the grant. Every other failure is ProviderFailed.
       */
      const tokenRequest = Effect.fnUntraced(function* (binding: OAuthBinding, params: Record<string, string>) {
        const response = yield* HttpClientRequest.post(binding.pinned.tokenUrl).pipe(
          HttpClientRequest.acceptJson,
          HttpClientRequest.bodyUrlParams({ ...params, client_id: binding.clientId, client_secret: binding.clientSecret.reveal() }),
          http.execute,
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

      const refreshOnce = Effect.fnUntraced(function* (
        install: Install,
        name: string,
        binding: OAuthBinding,
        connection: OAuthConnection,
      ) {
        if (!connection.refreshToken) return (yield* DateTime.isPast(connection.expiresAt)) ? null : connection;

        const body = yield* tokenRequest(binding, {
          grant_type: "refresh_token",
          refresh_token: connection.refreshToken.reveal(),
        });
        const refreshed = body === "invalid_grant" ? undefined : yield* toConnection(binding, body, connection.refreshToken);

        return yield* installs.replaceConnection(install.id, name, connection, refreshed);
      });

      /** One refresh per connection record at a time. Concurrent callers await the same Deferred. Null when the grant is gone. */
      const refresh = Effect.fnUntraced(function* (
        install: Install,
        name: string,
        binding: OAuthBinding,
        connection: OAuthConnection,
      ) {
        const inFlight = refreshes.get(connection);
        if (inFlight) return yield* Deferred.await(inFlight);

        const deferred = Deferred.makeUnsafe<OAuthConnection | null, ProviderFailed>();
        refreshes.set(connection, deferred);
        yield* Deferred.into(refreshOnce(install, name, binding, connection), deferred).pipe(
          Effect.ensuring(Effect.sync(() => refreshes.delete(connection))),
        );
        return yield* Deferred.await(deferred);
      });

      return Connections.of({
        setOAuthClient: Effect.fnUntraced(function* (_, appId, name, client) {
          const app = yield* apps.get(appId);
          const need = app.latest?.manifest.needs.credentials?.[name];
          if (need?.type !== "oauth2") return yield* new NotFound({ message: `no oauth2 credential ${name}` });

          const { authorizeUrl, tokenUrl, scopes } = need;
          const id = createHash("sha256").update(JSON.stringify([authorizeUrl, tokenUrl])).digest("base64url").slice(0, 22);
          const clientSecret = new Sealed(client.clientSecret);
          yield* Ref.update(clients, (all) => {
            const current = all.get(appId)?.get(name);
            const binding: OAuthBinding =
              current?.id === id && current.clientId === client.clientId
                ? { ...current, clientSecret }
                : { id, generation: randomToken(), clientId: client.clientId, clientSecret, pinned: { authorizeUrl, tokenUrl } };
            return withEntry(all, appId, withEntry(all.get(appId) ?? new Map<string, OAuthBinding>(), name, binding));
          });
          return { redirectUri: redirectUriFor(id), authorizeUrl, tokenUrl, scopes };
        }),

        beginOAuthConnect: Effect.fnUntraced(function* (install, name, owner) {
          const { need, binding } = yield* oauthBinding(install, name);

          const state = randomToken();
          const connect: PendingConnect = {
            installId: install.id,
            credential: name,
            bindingId: binding.id,
            generation: binding.generation,
            ...owner,
            expiresAt: DateTime.add(yield* DateTime.now, CONNECT_TTL),
          };
          yield* Ref.update(pending, (all) => withEntry(all, state, connect));
          const url = new URL(binding.pinned.authorizeUrl);
          url.searchParams.set("response_type", "code");
          url.searchParams.set("client_id", binding.clientId);
          url.searchParams.set("redirect_uri", redirectUriFor(binding.id));
          url.searchParams.set("scope", need.scopes.join(" "));
          url.searchParams.set("state", state);
          // URLSearchParams encodes spaces as "+". HubSpot documents scopes joined by "%20".
          url.search = url.searchParams.toString().replaceAll("+", "%20");
          return url.toString();
        }),

        finishOAuthConnect: Effect.fnUntraced(function* (session, bindingId, query) {
          const connect = yield* Ref.modify(pending, (all) => [all.get(query.state), withEntry(all, query.state, undefined)] as const);
          if (!connect || DateTime.isLessThanOrEqualTo(connect.expiresAt, yield* DateTime.now)) {
            return yield* new BadRequest({ message: "unknown or expired connect" });
          }
          if (connect.sessionId !== null && connect.sessionId !== session?.id) {
            return yield* new Forbidden({ message: "this connect was started by another session" });
          }
          if (connect.bindingId !== bindingId) {
            return yield* new BadRequest({ message: "callback does not match the connect's OAuth client" });
          }
          if ("error" in query) return yield* new BadRequest({ message: `the provider returned ${query.error}` });

          const install = yield* installs.get(connect.installId);
          if (session && connect.sessionId !== null) {
            yield* Effect.fromResult(authorize(session.principal, { type: "install.connect", install }));
          }
          const { binding } = yield* oauthBinding(install, connect.credential);
          if (binding.generation !== connect.generation) {
            return yield* new Conflict({ message: "the OAuth client changed during the connect" });
          }

          const body = yield* tokenRequest(binding, {
            grant_type: "authorization_code",
            code: query.code,
            redirect_uri: redirectUriFor(binding.id),
          });
          if (body === "invalid_grant") return yield* new ProviderFailed({ message: "the provider refused the code" });
          yield* installs.connect(install.id, connect.credential, yield* toConnection(binding, body, null));
          return { install, credential: connect.credential, returnTo: connect.returnTo };
        }),

        connectApiKey: Effect.fnUntraced(function* ({ action: { install } }, name, key) {
          if (install.version.manifest.needs.credentials?.[name]?.type !== "apiKey") {
            return yield* new NotFound({ message: `no apiKey credential ${name}` });
          }
          yield* installs.connect(install.id, name, { type: "apiKey", key: new Sealed(key) });
        }),

        status: Effect.fnUntraced(function* (install) {
          const now = yield* DateTime.now;
          const status: Record<string, CredentialStatus> = {};
          for (const [name, need] of Object.entries(install.version.manifest.needs.credentials ?? {})) {
            const connection = install.connections.get(name);
            status[name] = { type: need.type, connected: connected(need, connection, yield* clientOf(install.appId, name), now) };
          }
          return status;
        }),

        get: Effect.fnUntraced(function* (installId, name) {
          const install = yield* installs.get(installId);
          const need = install.version.manifest.needs.credentials?.[name];
          if (!need) return yield* new NotDeclared({ message: `credential "${name}" is not declared in the manifest` });

          const missing = new CredentialMissing({ message: `credential "${name}" is not connected` });
          const connection = install.connections.get(name);
          const binding = yield* clientOf(install.appId, name);
          const now = yield* DateTime.now;
          if (!connection || !connected(need, connection, binding, now)) return yield* missing;
          if (connection.type === "apiKey") return { type: "apiKey", key: connection.key.reveal() } satisfies CredentialValue;
          if (!binding) return yield* missing;

          const stale = DateTime.isLessThanOrEqualTo(connection.expiresAt, DateTime.add(now, REFRESH_MARGIN));
          const fresh = stale ? yield* refresh(install, name, binding, connection) : connection;
          if (!fresh || !connected(need, fresh, yield* clientOf(install.appId, name), now)) return yield* missing;
          return {
            type: "oauth2",
            accessToken: fresh.accessToken.reveal(),
            expiresAt: DateTime.formatIso(fresh.expiresAt),
          } satisfies CredentialValue;
        }),
      });
    }),
  );
}

function connected(need: CredentialNeed, connection: Connection | undefined, client: OAuthBinding | undefined, now: DateTime.Utc): boolean {
  if (connection?.type !== need.type) return false;
  if (connection.type === "apiKey") return true;
  return connection.generation === client?.generation && (connection.refreshToken !== null || DateTime.isGreaterThan(connection.expiresAt, now));
}

const TOKEN_TIMEOUT = "10 seconds";
const JsonObject = Schema.Record(Schema.String, Schema.Unknown);
const TokenError = Schema.Struct({ error: Schema.String });
const TokenFields = Schema.Struct({
  access_token: Schema.String,
  expires_in: Schema.Number,
  refresh_token: Schema.optionalKey(Schema.String),
});

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
    generation: binding.generation,
    accessToken: new Sealed(tokens.access_token),
    expiresAt: DateTime.add(yield* DateTime.now, { seconds: tokens.expires_in }),
    refreshToken: tokens.refresh_token !== undefined ? new Sealed(tokens.refresh_token) : previousRefresh,
    providerFields,
  };
  return connection;
});
