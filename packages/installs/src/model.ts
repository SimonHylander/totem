import type { AppId, InstallId, TenantId } from "@totem/ids";
import type { AppVersion } from "@totem/versions";
import { Schema } from "effect";

/**
 * Where an install is in its lifecycle. A new install is Pending while its `install` hook runs, and
 * Active once the hook succeeds or the app has none. Only Active installs run actions.
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

/** The fields of an install this package reads. The platform stores more, and every function here takes any record with these. */
export type InstallCore = {
  readonly id: InstallId;
  readonly tenantId: TenantId;
  readonly appId: AppId;
  /** The app version this install runs (ADR 0017). Calls and checks read its manifest. */
  readonly version: AppVersion;
  readonly status: InstallStatus;
  /** Per-install settings, validated against the manifest's `config` schema and sent in every call context. */
  readonly config: Readonly<Record<string, unknown>>;
  /** By port name. A declared port with no entry is unbound. */
  readonly bindings: ReadonlyMap<string, PortBinding>;
};

declare class ActiveMark {
  private readonly active: true;
}
declare class StoredMark {
  private readonly stored: true;
}

/** An install that may run actions. Only `requireActive` mints one. An object literal or a spread copy is not one. */
export type ActiveInstall<I extends InstallCore = InstallCore> = I & ActiveMark & { readonly status: { readonly _tag: "Active" } };

/** An install read from storage, so its tenant is the stored one, not one from a request. Only the platform's store mints one. An object literal or a spread copy is not one. */
export type StoredInstall<I extends InstallCore = InstallCore> = I & StoredMark;
