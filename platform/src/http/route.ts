import type { MethodHandlers, PlatformMethods, SignedPlatformMethods } from "@totem/protocol";
import type { Principal } from "@totem/permissions";
import { Effect, Schema } from "effect";
import type { Session } from "../access/access.js";
import type { CallbackClaims } from "../app-calls/callback-token.js";
import { BadRequest, type PlatformError } from "../errors.js";
import type { Install } from "../installs/installs.js";
import type { Services } from "../platform.js";

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

export type Page = {
  path: string;
  pattern: RegExp;
  run: (request: Request, params: Record<string, string>, session: Session | null) => Effect.Effect<Response, PlatformError, Services>;
};

export function page(path: string, run: Page["run"]): Page {
  return { path, pattern: pathPattern(path), run };
}

export type CallbackMethods = Partial<MethodHandlers<typeof PlatformMethods, CallbackClaims, PlatformError, Services>>;

export type SignedMethods = Partial<MethodHandlers<typeof SignedPlatformMethods, Install, PlatformError, Services>>;

/** `/a/:b` matches `/a/x` with the group `b` set to `x`. */
function pathPattern(path: string): RegExp {
  return new RegExp(`^${path.replace(/:(\w+)/g, "(?<$1>[^/]+)")}$`);
}
