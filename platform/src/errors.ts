import type { ActionNotProvided, ForeignInstall, IllegalTransition, InstallNotActive, PortNotDeclared } from "@totem/installs";
import type { Forbidden } from "@totem/permissions";
import { Schema } from "effect";

// Domain failures. Operations fail with these and never name a wire format. The HTTP shell maps
// each tag to a status (`http.ts`), the JSON-RPC shell to an ErrorCode (`platform-methods.ts`).

/** No or unknown management token. */
export class Unauthenticated extends Schema.TaggedError<Unauthenticated>()("Unauthenticated", {
  message: Schema.String,
}) {}

export { Forbidden } from "@totem/permissions";

export class NotFound extends Schema.TaggedError<NotFound>()("NotFound", { message: Schema.String }) {}

/** The request is valid but the platform's state does not allow it yet, such as a missing OAuth client. */
export class Conflict extends Schema.TaggedError<Conflict>()("Conflict", { message: Schema.String }) {}

/** Malformed input: a request body, params, or an OAuth callback query. */
export class BadRequest extends Schema.TaggedError<BadRequest>()("BadRequest", { message: Schema.String }) {}

/** A port, credential or state the caller's manifest does not declare. */
export class NotDeclared extends Schema.TaggedError<NotDeclared>()("NotDeclared", { message: Schema.String }) {}

export class PortUnbound extends Schema.TaggedError<PortUnbound>()("PortUnbound", { message: Schema.String }) {}

/** A port call nested past the depth limit (ADR 0013). */
export class CallDepthExceeded extends Schema.TaggedError<CallDepthExceeded>()("CallDepthExceeded", {
  message: Schema.String,
}) {}

export class CredentialMissing extends Schema.TaggedError<CredentialMissing>()("CredentialMissing", {
  message: Schema.String,
}) {}

/** A manifest the platform refuses, such as an OAuth endpoint that is not https. */
export class InvalidManifest extends Schema.TaggedError<InvalidManifest>()("InvalidManifest", {
  message: Schema.String,
}) {}

/** An OAuth provider's token endpoint failed or answered something unusable. */
export class ProviderFailed extends Schema.TaggedError<ProviderFailed>()("ProviderFailed", {
  message: Schema.String,
}) {}

/**
 * An app answered a platform call with a JSON-RPC error. Both shells pass it through unchanged, so a
 * forwarded port call surfaces the provider's own error (ADR 0013).
 */
export class AppFailed extends Schema.TaggedError<AppFailed>()("AppFailed", {
  code: Schema.Number,
  message: Schema.String,
  data: Schema.optional(Schema.Unknown),
}) {}

export type PlatformError =
  | Unauthenticated
  | Forbidden
  | NotFound
  | Conflict
  | BadRequest
  | NotDeclared
  | PortNotDeclared
  | ActionNotProvided
  | ForeignInstall
  | InstallNotActive
  | IllegalTransition
  | PortUnbound
  | CallDepthExceeded
  | CredentialMissing
  | InvalidManifest
  | ProviderFailed
  | AppFailed;
