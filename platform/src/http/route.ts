import type { MethodHandlers, PlatformMethods, SignedPlatformMethods } from "@totem/protocol";
import type { Principal } from "@totem/permissions";
import { Effect, Schema } from "effect";
import type { Session } from "../access/access.js";
import type { CallbackClaims } from "../app-calls/callback-token.js";
import { BadRequest, type PlatformError } from "../errors.js";
import type { Install } from "../installs/installs.js";
import type { Services } from "../platform.js";

// The shapes of the platform's inbound handlers. Each capability folder declares its own routes,
// platform methods and pages with these, and `api.ts`, `rpc.ts` and `pages.ts` merge them.

/**
 * One management route: a path template such as `/api/apps/:appId`, the schemas its path params and
 * body decode with, and the operation it runs.
 */
export type Route = {
  method: string;
  path: string;
  pattern: RegExp;
  run: (principal: Principal, params: Record<string, string>, body: unknown) => Effect.Effect<unknown, PlatformError, Services>;
};

export function route<P extends Schema.Decoder<unknown>, S extends Schema.Decoder<unknown>>(
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
    pattern: pathPattern(path),
    run: (principal, rawParams, rawBody) =>
      Effect.all([decodeParams(rawParams), decodeBody(rawBody)]).pipe(
        Effect.mapError((error) => new BadRequest({ message: error.message })),
        Effect.flatMap(([decodedParams, decodedBody]) => run(principal, decodedParams, decodedBody)),
      ),
  };
}

export const NoParams = Schema.Struct({});
export const NonEmpty = Schema.NonEmptyString;

/** One browser page: a path template and the response for a request, given the browser's session if it has one. */
export type Page = {
  path: string;
  pattern: RegExp;
  run: (request: Request, params: Record<string, string>, session: Session | null) => Effect.Effect<Response, PlatformError, Services>;
};

export function page(path: string, run: Page["run"]): Page {
  return { path, pattern: pathPattern(path), run };
}

/** Methods apps call with a callback token (ADR 0008). `rpc.ts` checks that the merged set is complete. */
export type CallbackMethods = Partial<MethodHandlers<typeof PlatformMethods, CallbackClaims, PlatformError, Services>>;

/** Methods apps sign with their HMAC secret (ADR 0014, ADR 0015). The install is verified before the method runs. */
export type SignedMethods = Partial<MethodHandlers<typeof SignedPlatformMethods, Install, PlatformError, Services>>;

/** `/a/:b` matches `/a/x` with the group `b` set to `x`. */
function pathPattern(path: string): RegExp {
  return new RegExp(`^${path.replace(/:(\w+)/g, "(?<$1>[^/]+)")}$`);
}
