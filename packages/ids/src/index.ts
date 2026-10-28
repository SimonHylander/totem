import { Schema } from "effect";

// Branded IDs of platform records. Decode wire input with these schemas at the edges: HTTP routes,
// signed method params and callback token claims. Inside, only the branded types are accepted, so a
// tenant ID cannot be passed where an install ID belongs.

/** An app registered on the platform. */
export const AppId = Schema.NonEmptyString.pipe(Schema.brand("AppId"));
export type AppId = typeof AppId.Type;

/** One tenant's install of an app. */
export const InstallId = Schema.NonEmptyString.pipe(Schema.brand("InstallId"));
export type InstallId = typeof InstallId.Type;

/** A tenant. Tenants exist only as the owner named on installs and roles. */
export const TenantId = Schema.NonEmptyString.pipe(Schema.brand("TenantId"));
export type TenantId = typeof TenantId.Type;

/** One platform-to-app action call, named in its callback token and context. */
export const CallId = Schema.NonEmptyString.pipe(Schema.brand("CallId"));
export type CallId = typeof CallId.Type;

/** One immutable manifest an app returned from `initialize` (ADR 0017). */
export const VersionId = Schema.NonEmptyString.pipe(Schema.brand("VersionId"));
export type VersionId = typeof VersionId.Type;
