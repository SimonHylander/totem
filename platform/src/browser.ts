import { HttpError, csrfToken, sessionFor, signIn, type Session } from "./access.js";
import { OAUTH_CALLBACK_PATH, beginOAuthConnect, finishOAuthConnect, type CallbackQuery } from "./connections.js";
import type { Context } from "./store.js";

// Browser pages. OAuth consent is a browser flow, so connecting runs here with a session cookie
// instead of on the bearer-token API (ADR 0011).
//
//   GET  /signin                           sign-in form
//   POST /signin                           management token in, session cookie out
//   GET  /installs/:id/connect/:credential page with a Connect button
//   POST /installs/:id/connect/:credential start the connect, redirect to the provider
//   GET  /oauth/callback/:binding          the provider's redirect. Connects an app began through
//                                          `ports/connect` need no session and return to the app (ADR 0015).

const COOKIE = "totem_session";
const CONNECT = /^\/installs\/(?<installId>[^/]+)\/connect\/(?<name>[^/]+)$/;
const CALLBACK = new RegExp(`^${OAUTH_CALLBACK_PATH}/(?<bindingId>[^/]+)$`);

export async function handleBrowser(ctx: Context, request: Request): Promise<Response> {
  const url = new URL(request.url);
  const session = sessionFor(ctx.store, cookie(request, COOKIE));
  try {
    // Browsers send Origin on cross-site form posts. Refusing them stops another site from signing
    // a victim in as the attacker (login CSRF) or submitting a connect form.
    const origin = request.headers.get("origin");
    if (request.method === "POST" && origin !== null && origin !== new URL(ctx.baseUrl).origin) {
      throw new HttpError(403, "cross-site form post");
    }

    if (url.pathname === "/signin") {
      return request.method === "POST" ? await submitSignIn(ctx, request) : signInPage(url.searchParams.get("next") ?? "/");
    }

    const connect = CONNECT.exec(url.pathname)?.groups;
    if (connect) {
      if (!session) return redirect(`/signin?next=${encodeURIComponent(url.pathname)}`);
      if (request.method === "GET") return connectPage(session, connect["name"]!);
      const form = await request.formData();
      if (form.get("csrf") !== csrfToken(session)) throw new HttpError(403, "invalid form token");
      return redirect(beginOAuthConnect(ctx, session, connect["installId"]!, connect["name"]!));
    }

    const callback = CALLBACK.exec(url.pathname)?.groups;
    if (callback && request.method === "GET") {
      const done = await finishOAuthConnect(ctx, session, callback["bindingId"]!, callbackQuery(url));
      if (done.returnTo) return redirect(done.returnTo);
      return page(200, "Connected", `<p>${escape(done.credential)} is connected for tenant ${escape(done.install.tenantId)}.</p>`);
    }
  } catch (error) {
    if (error instanceof HttpError) return page(error.status, "Error", `<p>${escape(error.message)}</p>`);
    throw error;
  }
  return page(404, "Not found", "");
}

async function submitSignIn(ctx: Context, request: Request): Promise<Response> {
  const form = await request.formData();
  const session = signIn(ctx.store, String(form.get("token") ?? ""));
  if (!session) return page(401, "Sign in", "<p>Unknown token.</p>");
  const next = String(form.get("next") ?? "/");
  const secure = new URL(ctx.baseUrl).hostname === "localhost" ? "" : "; Secure";
  return new Response(null, {
    status: 303,
    headers: {
      // Only same-site paths, so the form cannot redirect elsewhere. Browsers read "/\" as "//".
      location: /^\/(?![/\\])/.test(next) ? next : "/",
      "set-cookie": `${COOKIE}=${session.id}; HttpOnly; SameSite=Lax; Path=/${secure}`,
    },
  });
}

function signInPage(next: string): Response {
  return page(
    200,
    "Sign in",
    `<form method="post" action="/signin">
      <input type="hidden" name="next" value="${escape(next)}">
      <label>Management token <input type="password" name="token" autofocus></label>
      <button>Sign in</button>
    </form>`,
  );
}

function connectPage(session: Session, name: string): Response {
  return page(
    200,
    `Connect ${name}`,
    `<p>Signed in as ${escape(session.principal.id)}.</p>
    <form method="post">
      <input type="hidden" name="csrf" value="${csrfToken(session)}">
      <button>Connect ${escape(name)}</button>
    </form>`,
  );
}

function callbackQuery(url: URL): CallbackQuery {
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  if (!state) throw new HttpError(400, "the callback has no state");
  if (code) return { state, code };
  return { state, error: error ?? "no code" };
}

function cookie(request: Request, name: string): string | undefined {
  for (const part of request.headers.get("cookie")?.split(";") ?? []) {
    const [key, value] = part.trim().split("=", 2);
    if (key === name) return value;
  }
  return undefined;
}

function redirect(location: string): Response {
  return new Response(null, { status: 303, headers: { location } });
}

function page(status: number, title: string, body: string): Response {
  const html = `<!doctype html><meta charset="utf-8"><title>${escape(title)} · Totem</title><h1>${escape(title)}</h1>${body}`;
  return new Response(html, { status, headers: { "content-type": "text/html; charset=utf-8" } });
}

function escape(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
