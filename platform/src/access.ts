import { createHash } from "node:crypto";
import { TenantId } from "@totem/ids";
import { DateTime, Effect, Schema } from "effect";
import { Forbidden, Unauthenticated } from "./errors.js";
import { Store, randomToken, type Install } from "./store.js";

// Platform access (ADR 0011). Only the management API uses it. Apps never see a principal.

export const Role = Schema.Union([
  Schema.Struct({ name: Schema.Literal("operator") }),
  Schema.Struct({ name: Schema.Literal("tenantAdmin"), tenantId: TenantId }),
]);
export type Role = typeof Role.Type;

/** The holder of a management token: a person or a CI job. `id` names it in logs. Operators configure principals, so they are decoded at startup. */
export const Principal = Schema.Struct({ id: Schema.String, role: Role });
export type Principal = typeof Principal.Type;

/**
 * Every management action. Install-scoped actions carry the stored install, so the tenant that
 * `can` compares comes from the store, never from the request.
 */
export type ManagementAction =
  | { type: "app.register" }
  | { type: "app.setOAuthClient" }
  | { type: "app.setVisibility" }
  | { type: "install.create"; tenantId: TenantId }
  | { type: "install.connect"; install: Install }
  | { type: "install.bind"; install: Install }
  | { type: "install.invoke"; install: Install };

/**
 * A browser signed in with a management token. OAuth consent needs it, because the provider
 * redirect is a plain browser GET and the platform must know that the browser finishing a connect
 * is the one that started it (RFC 6749 section 10.12).
 */
export type Session = { id: string; principal: Principal; expiresAt: DateTime.Utc };

/** The token in an `Authorization: Bearer` header, or an empty string. */
export function bearerToken(request: Request): string {
  return request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Resolve a management token to its principal. */
export const authenticate = Effect.fnUntraced(function* (token: string) {
  const principal = (yield* Store).apiTokens.get(hashToken(token));
  if (!principal) return yield* new Unauthenticated({ message: "missing or unknown management token" });
  return principal;
});

/**
 * The only authorization rule. Every management function calls it before it acts. Custom roles,
 * audit and approvals later change this function, not its callers.
 */
export function can({ role }: Principal, action: ManagementAction): boolean {
  if (role.name === "operator") return true;
  switch (action.type) {
    case "app.register":
    case "app.setOAuthClient":
    case "app.setVisibility":
      return false;
    case "install.create":
      return action.tenantId === role.tenantId;
    case "install.connect":
    case "install.bind":
    case "install.invoke":
      return action.install.tenantId === role.tenantId;
  }
}

/** `can`, or Forbidden. */
export const authorize = (principal: Principal, action: ManagementAction): Effect.Effect<void, Forbidden> =>
  can(principal, action) ? Effect.void : Effect.fail(new Forbidden({ message: `${principal.id} may not ${action.type}` }));

const SESSION_TTL = { hours: 12 };

/** Exchange a management token for a browser session. The development login until an IdP exists. */
export const signIn = Effect.fnUntraced(function* (token: string) {
  const principal = yield* authenticate(token);
  const session: Session = { id: randomToken(), principal, expiresAt: DateTime.add(yield* DateTime.now, SESSION_TTL) };
  yield* (yield* Store).sessions.put(session);
  return session;
});

/** The live session a cookie names, or null. */
export const sessionFor = Effect.fnUntraced(function* (id: string | undefined) {
  const session = id ? yield* (yield* Store).sessions.lookup(id) : undefined;
  if (!session || DateTime.isLessThanOrEqualTo(session.expiresAt, yield* DateTime.now)) return null;
  return session;
});

/** Forms that change state with a session cookie carry this, so other sites cannot submit them. */
export function csrfToken(session: Session): string {
  return hashToken(`csrf:${session.id}`);
}
