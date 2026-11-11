import { createHash } from "node:crypto";
import type { InstallId } from "@totem/ids";
import { authorize, type InstallActionType, type Principal } from "@totem/permissions";
import { Context, DateTime, Effect, Layer } from "effect";
import { Unauthenticated } from "./errors.js";
import { Installs, type Install } from "./installs.js";
import { randomToken } from "./secrets.js";
import { makeTable, type Table } from "./table.js";

// Platform access (ADR 0011). Only the management API uses it. Apps never see a principal.

/** An install-scoped action on a stored install. */
export type InstallAction<T extends InstallActionType> = { readonly type: T; readonly install: Install };

/**
 * A browser signed in with a management token. OAuth consent needs it, because the provider
 * redirect is a plain browser GET and the platform must know that the browser finishing a connect
 * is the one that started it (RFC 6749 section 10.12).
 */
export type Session = { id: string; principal: Principal; expiresAt: DateTime.Utc };

/** Who can manage the platform: the management tokens by SHA-256 hex, and the browser sessions signed in with them. */
export class Access extends Context.Service<
  Access,
  {
    readonly apiTokens: ReadonlyMap<string, Principal>;
    readonly sessions: Table<string, Session>;
  }
>()("@totem/platform/Access") {
  static readonly layer = (apiTokens: ReadonlyMap<string, Principal>) =>
    Layer.effect(
      Access,
      Effect.map(makeTable("session", (session: Session) => session.id), (sessions) => Access.of({ apiTokens, sessions })),
    );
}

/** The token in an `Authorization: Bearer` header, or an empty string. */
export function bearerToken(request: Request): string {
  return request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Resolve a management token to its principal. */
export const authenticate = Effect.fnUntraced(function* (token: string) {
  const principal = (yield* Access).apiTokens.get(hashToken(token));
  if (!principal) return yield* new Unauthenticated({ message: "missing or unknown management token" });
  return principal;
});

/** Load an install and authorize an install-scoped action on it. */
export const authorizeInstall = <T extends InstallActionType>(principal: Principal, installId: InstallId, type: T) =>
  Installs.use((installs) => installs.get(installId)).pipe(
    Effect.flatMap((install) => Effect.fromResult(authorize<InstallAction<T>>(principal, { type, install }))),
  );

const SESSION_TTL = { hours: 12 };

/** Exchange a management token for a browser session. The development login until an IdP exists. */
export const signIn = Effect.fnUntraced(function* (token: string) {
  const principal = yield* authenticate(token);
  const session: Session = { id: randomToken(), principal, expiresAt: DateTime.add(yield* DateTime.now, SESSION_TTL) };
  yield* (yield* Access).sessions.put(session);
  return session;
});

/** The live session a cookie names, or null. */
export const sessionFor = Effect.fnUntraced(function* (id: string | undefined) {
  const session = id ? yield* (yield* Access).sessions.lookup(id) : undefined;
  if (!session || DateTime.isLessThanOrEqualTo(session.expiresAt, yield* DateTime.now)) return null;
  return session;
});

/** Forms that change state with a session cookie carry this, so other sites cannot submit them. */
export function csrfToken(session: Session): string {
  return hashToken(`csrf:${session.id}`);
}
