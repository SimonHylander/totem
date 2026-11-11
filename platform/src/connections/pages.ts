import { InstallId } from "@totem/ids";
import { Effect, Schema } from "effect";
import { authorizeInstall, csrfToken, type Session } from "../access/access.js";
import { BadRequest, Forbidden } from "../errors.js";
import { escape, html, redirect } from "../http/html.js";
import { OAUTH_CALLBACK_PATH } from "../http/paths.js";
import { page } from "../http/route.js";
import { Connections, type CallbackQuery } from "./connections.js";

// OAuth consent is a browser flow, so connecting runs on pages with a session cookie instead of on
// the bearer-token API (ADR 0011).

export const pages = [
  page(
    "/installs/:installId/connect/:name",
    Effect.fnUntraced(function* (request, { installId, name }, session) {
      if (!session) return redirect(`/signin?next=${encodeURIComponent(new URL(request.url).pathname)}`);
      if (request.method === "GET") return connectPage(session, name!);
      const form = yield* Effect.promise(() => request.formData());
      if (form.get("csrf") !== csrfToken(session)) return yield* new Forbidden({ message: "invalid form token" });
      const id = yield* Schema.decodeUnknownEffect(InstallId)(installId).pipe(
        Effect.mapError(() => new BadRequest({ message: "invalid install ID" })),
      );
      const { action } = yield* authorizeInstall(session.principal, id, "install.connect");
      const owner = { sessionId: session.id, returnTo: null };
      return redirect(yield* (yield* Connections).beginOAuthConnect(action.install, name!, owner));
    }),
  ),
  page(
    `${OAUTH_CALLBACK_PATH}/:bindingId`,
    Effect.fnUntraced(function* (request, { bindingId }, session) {
      if (request.method !== "GET") return html(404, "Not found", "");
      const done = yield* (yield* Connections).finishOAuthConnect(session, bindingId!, yield* callbackQuery(new URL(request.url)));
      if (done.returnTo) return redirect(done.returnTo);
      return html(200, "Connected", `<p>${escape(done.credential)} is connected for tenant ${escape(done.install.tenantId)}.</p>`);
    }),
  ),
];

function connectPage(session: Session, name: string): Response {
  return html(
    200,
    `Connect ${name}`,
    `<p>Signed in as ${escape(session.principal.id)}.</p>
    <form method="post">
      <input type="hidden" name="csrf" value="${csrfToken(session)}">
      <button>Connect ${escape(name)}</button>
    </form>`,
  );
}

function callbackQuery(url: URL): Effect.Effect<CallbackQuery, BadRequest> {
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  if (!state) return Effect.fail(new BadRequest({ message: "the callback has no state" }));
  return Effect.succeed(code ? { state, code } : { state, error: error ?? "no code" });
}
