import { Effect, Option } from "effect";
import { Headers, HttpTraceContext } from "effect/http";
import { authenticate, bearerToken } from "../access/access.js";
import { routes as appRoutes } from "../apps/routes.js";
import { routes as connectionRoutes } from "../connections/routes.js";
import { BadRequest, type PlatformError } from "../errors.js";
import { routes as installRoutes } from "../installs/routes.js";
import type { Services } from "../platform.js";

const routes = [...appRoutes, ...installRoutes, ...connectionRoutes];

export const STATUS: { [K in PlatformError["_tag"]]: number } = {
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
  IncompatibleVersion: 409,
  PortUnbound: 422,
  CallDepthExceeded: 422,
  CredentialMissing: 422,
  InvalidManifest: 422,
  ProviderFailed: 502,
  StateConflict: 409,
  AppFailed: 422,
};

function errorResponse(error: PlatformError): Response {
  const body =
    error._tag === "AppFailed"
      ? { error: { code: error.code, message: error.message, ...(error.data !== undefined && { data: error.data }) } }
      : { error: error.message };
  return Response.json(body, { status: STATUS[error._tag] });
}

const routeRequest = Effect.fnUntraced(function* (request: Request, pathname: string) {
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

/** Serve one management API request. A domain failure answers with its status. */
export const handleApi = (request: Request, pathname: string): Effect.Effect<Response, never, Services> =>
  routeRequest(request, pathname).pipe(Effect.catch((error) => Effect.succeed(errorResponse(error))));

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
