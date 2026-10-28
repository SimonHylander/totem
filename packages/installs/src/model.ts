import type { AppId, InstallId, TenantId } from "@totem/ids";
import type { AppVersion } from "@totem/versions";
import { Schema } from "effect";

// An install's lifecycle and its port bindings. The platform stores installs with more fields
// (config, connections, app state). Every function here takes any record with the core fields.

/**
 * Where an install is in its lifecycle. A new install is Pending while its `install` hook runs, and
 * Active once the hook succeeds or the app has none. Only Active installs run actions. More states
 * join when an operation reaches them, such as uninstall or upgrade.
 */
export const Pending = Schema.TaggedStruct("Pending", {});
export const Active = Schema.TaggedStruct("Active", {});
export const InstallStatus = Schema.Union([Pending, Active]);
export type InstallStatus = typeof InstallStatus.Type;

/** The install's `install` hook succeeded, or the app has none. */
export const HookSucceeded = Schema.TaggedStruct("HookSucceeded", {});
/** What happened to an install. `transition` decides the status each one leads to. */
export const InstallEvent = Schema.Union([HookSucceeded]);
export type InstallEvent = typeof InstallEvent.Type;

/** Where a port's calls go: an action on another install of the same tenant (ADR 0013). */
export type PortBinding = { readonly installId: InstallId; readonly action: string };

/** The fields of an install this package reads. */
export type InstallCore = {
  readonly id: InstallId;
  readonly tenantId: TenantId;
  readonly appId: AppId;
  /** The app version this install runs (ADR 0017). Calls and checks read its manifest. */
  readonly version: AppVersion;
  readonly status: InstallStatus;
  /** By port name. A declared port with no entry is unbound. */
  readonly bindings: ReadonlyMap<string, PortBinding>;
};

/** An install that may run actions. Only `requireActive` narrows to it. */
export type ActiveInstall<I extends InstallCore = InstallCore> = I & { readonly status: { readonly _tag: "Active" } };
