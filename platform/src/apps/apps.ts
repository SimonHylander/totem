import type { AppId } from "@totem/ids";
import type { AppVersion } from "@totem/versions";
import { Context, Layer } from "effect";
import type { Sealed } from "../secrets.js";
import { makeTable, type Table } from "../table.js";

// Registered apps. Every write goes through `operations.ts`.

export type Visibility = "public" | "internal";

export type AppRecord = {
  readonly id: AppId;
  readonly url: string;
  /** ADR 0008 platform-to-app signing key, issued at registration. */
  readonly secret: Sealed;
  /** The version new installs get. Null until `initialize` has pulled a manifest (ADR 0017). */
  readonly latest: AppVersion | null;
  /** Set by an operator. `apps/list` shows only public apps, and `ports/bind` binds only to them (ADR 0015). */
  readonly visibility: Visibility;
};

/** Registered apps by ID. */
export class Apps extends Context.Service<Apps, Table<AppId, AppRecord>>()("@totem/platform/Apps") {
  static readonly layer = Layer.effect(Apps, makeTable("app", (app: AppRecord) => app.id));
}
