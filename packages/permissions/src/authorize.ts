import { Result } from "effect";
import { Forbidden } from "./errors.js";
import type { ManagementAction, Principal } from "./model.js";

class Proof<A extends ManagementAction> {
  readonly #principal: Principal;
  readonly #action: Readonly<A>;

  constructor(principal: Principal, action: A) {
    this.#principal = principal;
    this.#action = Object.freeze({ ...action });
  }

  get principal(): Principal {
    return this.#principal;
  }

  get action(): Readonly<A> {
    return this.#action;
  }
}

/**
 * Proof that the check ran. Operations that need authorization take one instead of a principal.
 * Only `authorize` creates one, and a spread copy is not one. It holds a frozen copy of the action,
 * so nothing can change what was authorized.
 */
export type Authorized<A extends ManagementAction> = Proof<A>;

/** The only authorization rule. */
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
    case "install.upgrade":
      return action.install.tenantId === role.tenantId;
  }
}

/** Proof that `principal` may perform `action`, or Forbidden. */
export const authorize = <A extends ManagementAction>(
  principal: Principal,
  action: A,
): Result.Result<Authorized<A>, Forbidden> =>
  can(principal, action)
    ? Result.succeed(new Proof(principal, action))
    : Result.fail(new Forbidden({ message: `${principal.id} may not ${action.type}` }));
