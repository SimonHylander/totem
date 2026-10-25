import { createHash } from "node:crypto";
import type { Install, Store } from "./store.js";

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
  | { type: "install.create"; tenantId: string }
  | { type: "install.connect"; install: Install }
  | { type: "install.invoke"; install: Install };

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
