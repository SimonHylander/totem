import { Effect, Layer, ManagedRuntime, Schema } from "effect";
import { FetchHttpClient, type HttpClient } from "effect/http";
import { authenticate, bearerToken, hashToken, type Principal } from "./access.js";
import {
  PLATFORM_METHODS_PATH,
  createInstall,
  initializeApp,
  invokeAction,
  registerApp,
  setBinding,
  setVisibility,
} from "./apps.js";
import { errorPage, handleBrowser } from "./browser.js";
import { connectApiKey, setOAuthClient } from "./connections.js";
import { BadRequest, type PlatformError } from "./errors.js";
import { handlePlatformMethod } from "./platform-methods.js";
import { PlatformConfig, Store } from "./store.js";

// The HTTP shell. Routes decode the request and call one operation. Operations authorize themselves.
// This is the only place that maps domain failures to HTTP statuses.

export type PlatformOptions = {
  /** The platform's public origin, such as `http://localhost:3000`. */
  baseUrl: string;
  /** Management tokens and who holds them. */
  principals: { token: string; principal: Principal }[];
  allowLocalhost?: boolean;
  fetch?: typeof fetch;
};

type Services = Store | PlatformConfig | HttpClient.HttpClient;

const NonEmpty = Schema.NonEmptyString;
const PortBinding = Schema.Struct({ installId: NonEmpty, action: NonEmpty });
const JsonObject = Schema.Record(Schema.String, Schema.Unknown);

/** One management route: a path pattern, the body it accepts and the operation it runs. */
type Route = {
  method: string;
  pattern: RegExp;
  run: (principal: Principal, params: Record<string, string>, body: unknown) => Effect.Effect<unknown, PlatformError, Services>;
};

function route<S extends Schema.Decoder<unknown>>(
  method: string,
  pattern: RegExp,
  body: S,
  run: (principal: Principal, params: Record<string, string>, body: S["Type"]) => Effect.Effect<unknown, PlatformError, Services>,
): Route {
  const decode = Schema.decodeUnknownEffect(body);
  return {
    method,
    pattern,
    run: (principal, params, raw) =>
      decode(raw).pipe(
        Effect.mapError((error) => new BadRequest({ message: error.message })),
        Effect.flatMap((decoded) => run(principal, params, decoded)),
      ),
  };
}

const routes: Route[] = [
  route("POST", /^\/api\/apps$/, Schema.Struct({ url: NonEmpty }), (principal, _, { url }) => registerApp(principal, url)),
  route("POST", /^\/api\/apps\/(?<appId>[^/]+)\/initialize$/, Schema.Unknown, (principal, { appId }) =>
    Effect.map(initializeApp(principal, appId!), (manifest) => ({ manifest })),
  ),
  route(
    "PUT",
    /^\/api\/apps\/(?<appId>[^/]+)\/visibility$/,
    Schema.Struct({ visibility: Schema.Literals(["public", "internal"]) }),
    (principal, { appId }, { visibility }) => Effect.as(setVisibility(principal, appId!, visibility), {}),
  ),
  route(
    "PUT",
    /^\/api\/apps\/(?<appId>[^/]+)\/oauth-clients\/(?<name>[^/]+)$/,
    Schema.Struct({ clientId: NonEmpty, clientSecret: NonEmpty }),
    (principal, { appId, name }, client) => setOAuthClient(principal, appId!, name!, client),
  ),
  route(
    "POST",
    /^\/api\/tenants\/(?<tenantId>[^/]+)\/installs$/,
    Schema.Struct({
      appId: NonEmpty,
      config: Schema.optionalKey(JsonObject),
      bindings: Schema.optionalKey(Schema.Record(Schema.String, PortBinding)),
    }),
    (principal, { tenantId }, { appId, config = {}, bindings = {} }) =>
      Effect.map(createInstall(principal, tenantId!, appId, config, bindings), (install) => ({ installId: install.id })),
  ),
  route(
    "PUT",
    /^\/api\/installs\/(?<installId>[^/]+)\/bindings\/(?<port>[^/]+)$/,
    PortBinding,
    (principal, { installId, port }, binding) => Effect.as(setBinding(principal, installId!, port!, binding), {}),
  ),
  route(
    "PUT",
    /^\/api\/installs\/(?<installId>[^/]+)\/connections\/(?<name>[^/]+)\/api-key$/,
    Schema.Struct({ key: NonEmpty }),
    (principal, { installId, name }, { key }) => Effect.as(connectApiKey(principal, installId!, name!, key), {}),
  ),
  route(
    "POST",
    /^\/api\/installs\/(?<installId>[^/]+)\/actions\/(?<action>[^/]+)$/,
    Schema.Struct({ input: Schema.optionalKey(Schema.Unknown) }),
    (principal, { installId, action }, { input = {} }) =>
      Effect.map(invokeAction(principal, installId!, action!, input), (output) => ({ output })),
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
  ActionNotProvided: 422,
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
    return Response.json(yield* route.run(principal, match.groups ?? {}, body));
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
    Store.layer(new Map(principals.map(({ token, principal }) => [hashToken(token), principal]))),
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
  const handle = (request: Request): Promise<Response> => runtime.runPromise(handleRequest(request));
  return { handle, runtime };
}

const readJson = (request: Request) =>
  Effect.tryPromise({
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
