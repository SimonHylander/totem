import { AppId, InstallId, TenantId } from "@totem/ids";
import { Effect, Layer, ManagedRuntime, Option, Schema } from "effect";
import { FetchHttpClient, Headers, HttpTraceContext, type HttpClient } from "effect/http";
import { authenticate, bearerToken, hashToken, Principal } from "./access.js";
import {
  PLATFORM_METHODS_PATH,
  createInstall,
  initializeApp,
  invokeAction,
  registerApp,
  setBinding,
  setVisibility,
} from "./apps.js";
import { browserRoute, errorPage, handleBrowser } from "./browser.js";
import { connectApiKey, setOAuthClient } from "./connections.js";
import { BadRequest, type PlatformError } from "./errors.js";
import { handlePlatformMethod } from "./platform-methods.js";
import { PlatformConfig, Store } from "./store.js";

// The HTTP shell. Routes decode the request and call one operation. Operations authorize themselves.
// This is the only place that maps domain failures to HTTP statuses.

export type PlatformOptions = {
  /** The platform's public origin, such as `http://localhost:3000`. */
  baseUrl: string;
  /** Management tokens and who holds them. Decoded when the platform starts. */
  principals: { token: string; principal: typeof Principal.Encoded }[];
  allowLocalhost?: boolean;
  fetch?: typeof fetch;
};

type Services = Store | PlatformConfig | HttpClient.HttpClient;

const NonEmpty = Schema.NonEmptyString;
const PortBinding = Schema.Struct({ installId: InstallId, action: NonEmpty });
const JsonObject = Schema.Record(Schema.String, Schema.Unknown);

/**
 * One management route: a path template such as `/api/apps/:appId`, the schemas its path params and
 * body decode with, and the operation it runs.
 */
type Route = {
  method: string;
  path: string;
  pattern: RegExp;
  run: (principal: Principal, params: Record<string, string>, body: unknown) => Effect.Effect<unknown, PlatformError, Services>;
};

function route<P extends Schema.Decoder<unknown>, S extends Schema.Decoder<unknown>>(
  method: string,
  path: string,
  params: P,
  body: S,
  run: (principal: Principal, params: P["Type"], body: S["Type"]) => Effect.Effect<unknown, PlatformError, Services>,
): Route {
  const decodeParams = Schema.decodeUnknownEffect(params);
  const decodeBody = Schema.decodeUnknownEffect(body);
  return {
    method,
    path,
    pattern: new RegExp(`^${path.replace(/:(\w+)/g, "(?<$1>[^/]+)")}$`),
    run: (principal, rawParams, rawBody) =>
      Effect.all([decodeParams(rawParams), decodeBody(rawBody)]).pipe(
        Effect.mapError((error) => new BadRequest({ message: error.message })),
        Effect.flatMap(([decodedParams, decodedBody]) => run(principal, decodedParams, decodedBody)),
      ),
  };
}

const NoParams = Schema.Struct({});

const routes: Route[] = [
  route("POST", "/api/apps", NoParams, Schema.Struct({ url: NonEmpty }), (principal, _, { url }) => registerApp(principal, url)),
  route("POST", "/api/apps/:appId/initialize", Schema.Struct({ appId: AppId }), Schema.Unknown, (principal, { appId }) =>
    Effect.map(initializeApp(principal, appId), (manifest) => ({ manifest })),
  ),
  route(
    "PUT",
    "/api/apps/:appId/visibility",
    Schema.Struct({ appId: AppId }),
    Schema.Struct({ visibility: Schema.Literals(["public", "internal"]) }),
    (principal, { appId }, { visibility }) => Effect.as(setVisibility(principal, appId, visibility), {}),
  ),
  route(
    "PUT",
    "/api/apps/:appId/oauth-clients/:name",
    Schema.Struct({ appId: AppId, name: NonEmpty }),
    Schema.Struct({ clientId: NonEmpty, clientSecret: NonEmpty }),
    (principal, { appId, name }, client) => setOAuthClient(principal, appId, name, client),
  ),
  route(
    "POST",
    "/api/tenants/:tenantId/installs",
    Schema.Struct({ tenantId: TenantId }),
    Schema.Struct({
      appId: AppId,
      config: Schema.optionalKey(JsonObject),
      bindings: Schema.optionalKey(Schema.Record(Schema.String, PortBinding)),
    }),
    (principal, { tenantId }, { appId, config = {}, bindings = {} }) =>
      Effect.map(createInstall(principal, tenantId, appId, config, bindings), (install) => ({ installId: install.id })),
  ),
  route(
    "PUT",
    "/api/installs/:installId/bindings/:port",
    Schema.Struct({ installId: InstallId, port: NonEmpty }),
    PortBinding,
    (principal, { installId, port }, binding) => Effect.as(setBinding(principal, installId, port, binding), {}),
  ),
  route(
    "PUT",
    "/api/installs/:installId/connections/:name/api-key",
    Schema.Struct({ installId: InstallId, name: NonEmpty }),
    Schema.Struct({ key: NonEmpty }),
    (principal, { installId, name }, { key }) => Effect.as(connectApiKey(principal, installId, name, key), {}),
  ),
  route(
    "POST",
    "/api/installs/:installId/actions/:action",
    Schema.Struct({ installId: InstallId, action: NonEmpty }),
    Schema.Struct({ input: Schema.optionalKey(Schema.Unknown) }),
    (principal, { installId, action }, { input = {} }) =>
      Effect.map(invokeAction(principal, installId, action, input), (output) => ({ output })),
  ),
];

/** The HTTP status for each domain failure. */
const STATUS: { [K in PlatformError["_tag"]]: number } = {
  Unauthenticated: 401,
  Forbidden: 403,
  NotFound: 404,
  Conflict: 409,
  BadRequest: 400,
  NotDeclared: 422,
  PortNotDeclared: 422,
  ActionNotProvided: 422,
  ForeignInstall: 403,
  InstallNotActive: 409,
  IllegalTransition: 409,
  PortUnbound: 422,
  CallDepthExceeded: 422,
  CredentialMissing: 422,
  InvalidManifest: 422,
  ProviderFailed: 502,
  // A JSON-RPC error from an app: a failed action or a protocol error. The body keeps its code and data.
  AppFailed: 422,
};

function errorResponse(error: PlatformError): Response {
  const body =
    error._tag === "AppFailed"
      ? { error: { code: error.code, message: error.message, ...(error.data !== undefined && { data: error.data }) } }
      : { error: error.message };
  return Response.json(body, { status: STATUS[error._tag] });
}

const handleApi = Effect.fnUntraced(function* (request: Request, pathname: string) {
  for (const route of routes) {
    const match = route.method === request.method ? route.pattern.exec(pathname) : null;
    if (!match) continue;
    const principal = yield* authenticate(bearerToken(request));
    const body = request.method === "GET" ? {} : yield* readJson(request);
    // The principal has authenticated, so the caller's W3C traceparent header can be the parent (ADR 0016).
    const parent = HttpTraceContext.fromHeaders(Headers.fromInput(request.headers));
    const run = route.run(principal, match.groups ?? {}, body).pipe(
      Effect.withSpan(`${route.method} ${route.path}`, {
        kind: "server",
        attributes: { "http.route": route.path, "totem.principal": principal.id },
        ...(Option.isSome(parent) && { parent: parent.value }),
      }),
    );
    return Response.json(yield* run);
  }
  return Response.json({ error: `no route for ${request.method} ${pathname}` }, { status: 404 });
});

/** Route one request to the management API, the platform-methods endpoint or the browser pages. */
const handleRequest = (request: Request): Effect.Effect<Response, never, Services> => {
  const { pathname } = new URL(request.url);
  const handled: Effect.Effect<Response, PlatformError, Services> =
    request.method === "POST" && pathname === PLATFORM_METHODS_PATH
      ? handlePlatformMethod(request)
      : pathname.startsWith("/api/")
        ? handleApi(request, pathname).pipe(Effect.catch((error) => Effect.succeed(errorResponse(error))))
        : handleBrowser(request).pipe(
            Effect.catch((error) => Effect.succeed(errorPage(STATUS[error._tag], error.message))),
            // Public pages, so a trace header from the browser is never continued.
            Effect.withSpan(`${request.method} ${browserRoute(pathname)}`, { kind: "server", root: true }),
          );
  return handled.pipe(
    Effect.catchCause((cause) =>
      Effect.logError("request failed", cause).pipe(
        Effect.as(Response.json({ error: "internal error" }, { status: 500 })),
      ),
    ),
  );
};

/** The services every operation runs with. `fetch` reaches apps, and OAuth providers through HttpClient. */
export function platformLayer({ baseUrl, principals, allowLocalhost = false, fetch }: PlatformOptions) {
  return Layer.mergeAll(
    Store.layer(new Map(principals.map(({ token, principal }) => [hashToken(token), Schema.decodeUnknownSync(Principal)(principal)]))),
    Layer.succeed(PlatformConfig, { baseUrl, allowLocalhost }),
    FetchHttpClient.layer,
    fetch ? Layer.succeed(FetchHttpClient.Fetch, fetch) : Layer.empty,
  );
}

/**
 * Build the platform. `handle` serves the management API, the browser pages and the platform-methods
 * endpoint. `layer` adds or replaces services, such as a TestClock. `runtime` runs effects against
 * the same services, which tests use to drive the clock.
 */
export function createPlatform<R = never>(options: PlatformOptions, layer: Layer.Layer<R> = Layer.empty as Layer.Layer<R>) {
  const runtime = ManagedRuntime.make(Layer.merge(platformLayer(options), layer));
  // eslint-disable-next-line no-restricted-syntax -- the fetch-style handler servers call
  const handle = (request: Request): Promise<Response> => runtime.runPromise(handleRequest(request));
  return { handle, runtime };
}

const readJson = (request: Request) =>
  Effect.tryPromise({
    // eslint-disable-next-line no-restricted-syntax -- Request.text() is a Promise
    try: async () => {
      const text = await request.text();
      return text === "" ? {} : (JSON.parse(text) as unknown);
    },
    catch: () => new BadRequest({ message: "body must be a JSON object" }),
  }).pipe(
    Effect.filterOrFail(
      (body) => typeof body === "object" && body !== null && !Array.isArray(body),
      () => new BadRequest({ message: "body must be a JSON object" }),
    ),
  );
