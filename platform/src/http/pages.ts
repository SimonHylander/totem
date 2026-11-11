import { Effect } from "effect";
import { SESSION_COOKIE, sessionFor } from "../access/access.js";
import { pages as accessPages } from "../access/pages.js";
import { PlatformConfig } from "../config.js";
import { pages as connectionPages } from "../connections/pages.js";
import { Forbidden } from "../errors.js";
import { escape, html } from "./html.js";

// Browser pages. Failures are left to the HTTP shell, which renders them with `errorPage`.

const pages = [...accessPages, ...connectionPages];

/** Serve one browser request. */
export const handleBrowser = Effect.fnUntraced(function* (request: Request) {
  const { pathname } = new URL(request.url);
  const { baseUrl } = yield* PlatformConfig;
  const session = yield* sessionFor(cookie(request, SESSION_COOKIE));

  // Browsers send Origin on cross-site form posts. Refusing them stops another site from signing
  // a victim in as the attacker (login CSRF) or submitting a connect form.
  const origin = request.headers.get("origin");
  if (request.method === "POST" && origin !== null && origin !== new URL(baseUrl).origin) {
    return yield* new Forbidden({ message: "cross-site form post" });
  }

  for (const page of pages) {
    const match = page.pattern.exec(pathname);
    if (match) return yield* page.run(request, match.groups ?? {}, session);
  }
  return html(404, "Not found", "");
});

/** The route a browser request matches, without its IDs, to name its span. */
export function browserRoute(pathname: string): string {
  return pages.find((page) => page.pattern.test(pathname))?.path ?? "unmatched";
}

export function errorPage(status: number, message: string): Response {
  return html(status, "Error", `<p>${escape(message)}</p>`);
}

function cookie(request: Request, name: string): string | undefined {
  for (const part of request.headers.get("cookie")?.split(";") ?? []) {
    const [key, value] = part.trim().split("=", 2);
    if (key === name) return value;
  }
  return undefined;
}
