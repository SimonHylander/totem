import { Schema } from "effect";

// Failures of install operations. The platform maps each tag to an HTTP status and a JSON-RPC code.

/** `transition` has no rule for this event in this status. */
export class IllegalTransition extends Schema.TaggedError<IllegalTransition>()("IllegalTransition", {
  message: Schema.String,
}) {}

/** The install exists but may not run actions yet. */
export class InstallNotActive extends Schema.TaggedError<InstallNotActive>()("InstallNotActive", {
  message: Schema.String,
}) {}

/** A port the install's manifest does not declare in `needs.actions`. */
export class PortNotDeclared extends Schema.TaggedError<PortNotDeclared>()("PortNotDeclared", {
  message: Schema.String,
}) {}

/** An app's manifest does not provide the action a binding names. */
export class ActionNotProvided extends Schema.TaggedError<ActionNotProvided>()("ActionNotProvided", {
  message: Schema.String,
}) {}

/** A binding to an install of another tenant. */
export class ForeignInstall extends Schema.TaggedError<ForeignInstall>()("ForeignInstall", {
  message: Schema.String,
}) {}
