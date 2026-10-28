import { Result } from "effect";
import { Forbidden } from "./errors.js";
import type { ManagementAction, Principal } from "./model.js";

/**
 * Proof that `principal` may perform `action`. The class is not exported and its fields are
 * private, so only `authorize` creates one, and a spread copy is not a proof. The action is a frozen
 * copy, so neither the proof nor the object passed to `authorize` can change what was authorized.
 */
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

/** Proof that the check ran. Operations that need authorization take one instead of a principal. */
export type Authorized<A extends ManagementAction> = Proof<A>;

/**
 * The only authorization rule. Custom roles, audit and approvals later change this function, not
 * its callers.
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

/** Proof that `principal` may perform `action`, or Forbidden. */
export const authorize = <A extends ManagementAction>(
  principal: Principal,
  action: A,
): Result.Result<Authorized<A>, Forbidden> =>
  can(principal, action)
    ? Result.succeed(new Proof(principal, action))
    : Result.fail(new Forbidden({ message: `${principal.id} may not ${action.type}` }));
