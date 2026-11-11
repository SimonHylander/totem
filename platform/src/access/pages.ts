import { Effect } from "effect";
import { PlatformConfig } from "../config.js";
import { escape, html } from "../http/html.js";
import { page } from "../http/route.js";
import { SESSION_COOKIE, signIn } from "./access.js";

export const pages = [
  page("/signin", (request) =>
    request.method === "POST" ? submitSignIn(request) : Effect.succeed(signInPage(new URL(request.url).searchParams.get("next") ?? "/")),
  ),
];

const submitSignIn = Effect.fnUntraced(function* (request: Request) {
  const form = yield* Effect.promise(() => request.formData());
  const session = yield* signIn(String(form.get("token") ?? "")).pipe(
    Effect.catchTag("Unauthenticated", () => Effect.succeed(null)),
  );
  if (!session) return html(401, "Sign in", "<p>Unknown token.</p>");
  const next = String(form.get("next") ?? "/");
  const secure = new URL((yield* PlatformConfig).baseUrl).hostname === "localhost" ? "" : "; Secure";
  return new Response(null, {
    status: 303,
    headers: {
      // Only same-site paths, so the form cannot redirect elsewhere. Browsers read "/\" as "//".
      location: /^\/(?![/\\])/.test(next) ? next : "/",
      "set-cookie": `${SESSION_COOKIE}=${session.id}; HttpOnly; SameSite=Lax; Path=/${secure}`,
    },
  });
});

function signInPage(next: string): Response {
  return html(
    200,
    "Sign in",
    `<form method="post" action="/signin">
      <input type="hidden" name="next" value="${escape(next)}">
      <label>Management token <input type="password" name="token" autofocus></label>
      <button>Sign in</button>
    </form>`,
  );
}
