import type { AppId } from "@totem/ids";
import type { AppVersion } from "@totem/versions";
import { Context, Layer } from "effect";
import type { Sealed } from "../secrets.js";
import { makeTable, type Table } from "../table.js";

export type Visibility = "public" | "internal";

export type AppRecord = {
  readonly id: AppId;
  readonly url: string;
  readonly secret: Sealed;
  /** The version new installs get. Null until `initialize` has pulled a manifest (ADR 0017). */
  readonly latest: AppVersion | null;
  readonly visibility: Visibility;
};

export class Apps extends Context.Service<Apps, Table<AppId, AppRecord>>()("@totem/platform/Apps") {
  static readonly layer = Layer.effect(Apps, makeTable("app", (app: AppRecord) => app.id));
}
