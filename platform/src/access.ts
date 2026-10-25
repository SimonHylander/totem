import { createHash } from "node:crypto";
import { randomToken, type Install, type Store } from "./store.js";

// Platform access (ADR 0011). Only the management API uses it. Apps never see a principal.

export type Role = { name: "operator" } | { name: "tenantAdmin"; tenantId: string };

/** The holder of a management token: a person or a CI job. `id` names it in logs. */
export type Principal = { id: string; role: Role };

/**
 * Every management action. Install-scoped actions carry the stored install, so the tenant that
 * `can` compares comes from the store, never from the request.
 */
export type ManagementAction =
  | { type: "app.register" }
  | { type: "app.setOAuthClient" }
  | { type: "install.create"; tenantId: string }
  | { type: "install.connect"; install: Install }
  | { type: "install.invoke"; install: Install };

/**
 * A browser signed in with a management token. OAuth consent needs it, because the provider
 * redirect is a plain browser GET and the platform must know that the browser finishing a connect
 * is the one that started it (RFC 6749 section 10.12).
 */
export type Session = { id: string; principal: Principal; expiresAt: Date };

/** A management error with its HTTP status. Routes turn it into a JSON response. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

/** The token in an `Authorization: Bearer` header, or an empty string. */
export function bearerToken(request: Request): string {
  return request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Resolve a management token. Null means 401. */
export function authenticate(store: Store, token: string): Principal | null {
  return store.apiTokens.get(hashToken(token)) ?? null;
}

/**
 * The only authorization rule. Every management function calls it before it acts. Custom roles,
 * audit and approvals later change this function, not its callers.
 */
export function can({ role }: Principal, action: ManagementAction): boolean {
  if (role.name === "operator") return true;
  switch (action.type) {
    case "app.register":
    case "app.setOAuthClient":
      return false;
    case "install.create":
      return action.tenantId === role.tenantId;
    case "install.connect":
    case "install.invoke":
      return action.install.tenantId === role.tenantId;
  }
}

/** `can`, or a 403. */
export function authorize(principal: Principal, action: ManagementAction): void {
  if (!can(principal, action)) throw new HttpError(403, `${principal.id} may not ${action.type}`);
}

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

/** Exchange a management token for a browser session. The development login until an IdP exists. */
export function signIn(store: Store, token: string): Session | null {
  const principal = authenticate(store, token);
  if (!principal) return null;
  const session: Session = { id: randomToken(), principal, expiresAt: new Date(Date.now() + SESSION_TTL_MS) };
  store.sessions.set(session.id, session);
  return session;
}

/** The live session a cookie names, or null. */
export function sessionFor(store: Store, id: string | undefined): Session | null {
  const session = id ? store.sessions.get(id) : undefined;
  if (!session || session.expiresAt.getTime() <= Date.now()) return null;
  return session;
}

/** Forms that change state with a session cookie carry this, so other sites cannot submit them. */
export function csrfToken(session: Session): string {
  return hashToken(`csrf:${session.id}`);
}
