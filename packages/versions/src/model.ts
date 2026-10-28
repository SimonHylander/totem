import type { AppId, VersionId } from "@totem/ids";
import type { Manifest } from "@totem/protocol";
import { type DateTime, Schema } from "effect";

// App versions (ADR 0017). Every manifest an app returns from `initialize` is kept as an immutable
// version, and each install pins one.

export type AppVersion = {
  readonly id: VersionId;
  readonly appId: AppId;
  readonly manifest: Manifest;
  readonly pulledAt: DateTime.Utc;
};

/** Only `name`, `version` or `description` differ. */
export const Patch = Schema.TaggedStruct("Patch", {});
/** Something was added. `added` lists manifest paths such as `provides.actions.send`. */
export const Additive = Schema.TaggedStruct("Additive", { added: Schema.Array(Schema.String) });
/** Something an install or a consumer relies on was removed or changed. */
export const Breaking = Schema.TaggedStruct("Breaking", {
  removed: Schema.Array(Schema.String),
  changed: Schema.Array(Schema.String),
});
/** How one manifest differs from another, from the point of view of existing installs. */
export const Compat = Schema.Union([Patch, Additive, Breaking]);
export type Compat = typeof Compat.Type;
