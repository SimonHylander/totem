import type { Manifest } from "@totem/protocol";
import { Match, Result } from "effect";
import { ActionNotProvided, ForeignInstall, IllegalTransition, InstallNotActive, PortNotDeclared } from "./errors.js";
import { Active, type ActiveInstall, type InstallCore, type InstallEvent, type InstallStatus, type PortBinding } from "./model.js";

// Pure rules for installs. The platform reads and writes the records and calls these to decide.

/** The status `event` leads to from `status`, or IllegalTransition. */
export const transition = (status: InstallStatus, event: InstallEvent): Result.Result<InstallStatus, IllegalTransition> =>
  Match.value(event).pipe(
    Match.tagsExhaustive({
      HookSucceeded: () => (status._tag === "Pending" ? Result.succeed(Active.make({})) : illegal(status, event)),
    }),
  );

const illegal = (status: InstallStatus, event: InstallEvent) =>
  Result.fail(new IllegalTransition({ message: `${event._tag} is not allowed while the install is ${status._tag}` }));

/** The install, if it may run actions. */
export const requireActive = <I extends InstallCore>(install: I): Result.Result<ActiveInstall<I>, InstallNotActive> =>
  install.status._tag === "Active"
    ? Result.succeed(install as ActiveInstall<I>)
    : Result.fail(new InstallNotActive({ message: `install ${install.id} is ${install.status._tag}` }));

/** OK if `manifest` declares `port` in `needs.actions`. */
export const declaresPort = (manifest: Manifest, port: string): Result.Result<void, PortNotDeclared> =>
  Object.hasOwn(manifest.needs.actions ?? {}, port)
    ? Result.succeed(undefined)
    : Result.fail(new PortNotDeclared({ message: `port "${port}" is not declared in the manifest` }));

/** OK if `manifest` provides `action`. `name` says whose manifest it is in the error. */
export const providesAction = (manifest: Manifest, action: string, name: string): Result.Result<void, ActionNotProvided> =>
  Object.hasOwn(manifest.provides.actions ?? {}, action)
    ? Result.succeed(undefined)
    : Result.fail(new ActionNotProvided({ message: `${name} does not provide ${action}` }));

/**
 * The three ADR 0013 checks for binding `port` of `consumer` to `action` on `provider`, each against
 * its pinned version: the consumer declares the port, the provider is in the same tenant, and the
 * provider's version provides the action.
 */
export const checkBinding = (
  consumer: InstallCore,
  port: string,
  provider: InstallCore,
  action: string,
): Result.Result<PortBinding, PortNotDeclared | ForeignInstall | ActionNotProvided> =>
  Result.gen(function* () {
    yield* declaresPort(consumer.version.manifest, port);
    if (provider.tenantId !== consumer.tenantId) {
      return yield* Result.fail(new ForeignInstall({ message: `install ${provider.id} belongs to another tenant` }));
    }
    yield* providesAction(provider.version.manifest, action, `install ${provider.id}`);
    return { installId: provider.id, action };
  });

/** `install` with `port` bound to `binding`, or unbound when `binding` is undefined. */
export const withBinding = <I extends InstallCore>(install: I, port: string, binding: PortBinding | undefined): I => {
  const bindings = new Map(install.bindings);
  if (binding === undefined) bindings.delete(port);
  else bindings.set(port, binding);
  return { ...install, bindings };
};
