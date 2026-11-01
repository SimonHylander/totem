import { TenantId } from "@totem/ids";
import type { InstallCore } from "@totem/installs";
import { Schema } from "effect";

// Who may manage what on the platform (ADR 0011). Apps never see a principal.

export const Role = Schema.Union([
  Schema.Struct({ name: Schema.Literal("operator") }),
  Schema.Struct({ name: Schema.Literal("tenantAdmin"), tenantId: TenantId }),
]);
export type Role = typeof Role.Type;

/** The holder of a management token: a person or a CI job. `id` names it in logs. Operators configure principals, so they are decoded at startup. */
export const Principal = Schema.Struct({ id: Schema.String, role: Role });
export type Principal = typeof Principal.Type;

/** Actions on one stored install. */
export type InstallActionType = "install.connect" | "install.bind" | "install.invoke" | "install.upgrade";

/**
 * Every management action. Install-scoped actions carry the stored install, so the tenant that
 * `can` compares comes from the store, never from the request. `I` is the caller's install record.
 */
export type ManagementAction<I extends InstallCore = InstallCore> =
  | { readonly type: "app.register" }
  | { readonly type: "app.setOAuthClient" }
  | { readonly type: "app.setVisibility" }
  | { readonly type: "install.create"; readonly tenantId: TenantId }
  | { readonly type: InstallActionType; readonly install: I };
