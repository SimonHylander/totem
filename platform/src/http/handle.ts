import { Effect } from "effect";
import type { PlatformError } from "../errors.js";
import type { Services } from "../platform.js";
import { STATUS, handleApi } from "./api.js";
import { browserRoute, errorPage, handleBrowser } from "./pages.js";
import { PLATFORM_METHODS_PATH } from "./paths.js";
import { handlePlatformMethod } from "./rpc.js";

/** Route one request to the management API, the platform-methods endpoint or the browser pages. */
export const handleRequest = (request: Request): Effect.Effect<Response, never, Services> => {
  const { pathname } = new URL(request.url);
  const handled: Effect.Effect<Response, PlatformError, Services> =
    request.method === "POST" && pathname === PLATFORM_METHODS_PATH
      ? handlePlatformMethod(request)
      : pathname.startsWith("/api/")
        ? handleApi(request, pathname)
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
