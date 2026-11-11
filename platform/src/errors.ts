import type { ActionNotProvided, ForeignInstall, IllegalTransition, InstallNotActive, PortNotDeclared } from "@totem/installs";
import type { Forbidden } from "@totem/permissions";
import type { AppFailed, CallDepthExceeded, PortUnbound } from "@totem/runtime";
import type { IncompatibleVersion } from "@totem/versions";
import { Schema } from "effect";

export class Unauthenticated extends Schema.TaggedError<Unauthenticated>()("Unauthenticated", {
  message: Schema.String,
}) {}

export { Forbidden } from "@totem/permissions";
export { AppFailed, CallDepthExceeded, PortUnbound } from "@totem/runtime";

export class NotFound extends Schema.TaggedError<NotFound>()("NotFound", { message: Schema.String }) {}

/** The request is valid but the platform's state does not allow it yet, such as a missing OAuth client. */
export class Conflict extends Schema.TaggedError<Conflict>()("Conflict", { message: Schema.String }) {}

export class BadRequest extends Schema.TaggedError<BadRequest>()("BadRequest", { message: Schema.String }) {}

export class NotDeclared extends Schema.TaggedError<NotDeclared>()("NotDeclared", { message: Schema.String }) {}

export class CredentialMissing extends Schema.TaggedError<CredentialMissing>()("CredentialMissing", {
  message: Schema.String,
}) {}

export class InvalidManifest extends Schema.TaggedError<InvalidManifest>()("InvalidManifest", {
  message: Schema.String,
}) {}

/** An OAuth provider's token endpoint failed or answered something unusable. */
export class ProviderFailed extends Schema.TaggedError<ProviderFailed>()("ProviderFailed", {
  message: Schema.String,
}) {}

export class StateConflict extends Schema.TaggedError<StateConflict>()("StateConflict", {
  message: Schema.String,
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
  | IncompatibleVersion
  | PortUnbound
  | CallDepthExceeded
  | CredentialMissing
  | InvalidManifest
  | ProviderFailed
  | StateConflict
  | AppFailed;
