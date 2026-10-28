import type { Manifest } from "@totem/protocol";
import { Result } from "effect";
import { IncompatibleVersion } from "./errors.js";
import { Additive, Breaking, Patch, type Compat } from "./model.js";

/** Whether two JSON values are equal, ignoring object key order. */
export function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((key) => Object.hasOwn(b, key) && sameJson((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]));
}

/**
 * How `to` differs from `from` for existing installs (ADR 0017). Additions to provided actions,
 * triggers and ports are Additive. Any removal or change of those, and any change to credentials,
 * state or config, is Breaking.
 */
export function compare(from: Manifest, to: Manifest): Compat {
  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];

  const entries: [string, Readonly<Record<string, unknown>> | undefined, Readonly<Record<string, unknown>> | undefined][] = [
    ["provides.actions", from.provides.actions, to.provides.actions],
    ["provides.triggers", from.provides.triggers, to.provides.triggers],
    ["needs.actions", from.needs.actions, to.needs.actions],
  ];
  for (const [path, before = {}, after = {}] of entries) {
    for (const name of Object.keys(before)) {
      if (!(name in after)) removed.push(`${path}.${name}`);
      else if (!sameJson(before[name], after[name])) changed.push(`${path}.${name}`);
    }
    for (const name of Object.keys(after)) if (!(name in before)) added.push(`${path}.${name}`);
  }
  // A tenant must act on any credential change, so additions break too.
  if (!sameJson(from.needs.credentials ?? {}, to.needs.credentials ?? {})) changed.push("needs.credentials");
  if ((from.needs.state ?? false) !== (to.needs.state ?? false)) changed.push("needs.state");
  if (!sameJson(from.config, to.config)) changed.push("config");

  if (removed.length > 0 || changed.length > 0) return Breaking.make({ removed, changed });
  return added.length > 0 ? Additive.make({ added }) : Patch.make({});
}

/** The comparison, or IncompatibleVersion when it is Breaking. */
export function requireCompatible(from: Manifest, to: Manifest): Result.Result<Compat, IncompatibleVersion> {
  const compat = compare(from, to);
  return compat._tag === "Breaking"
    ? Result.fail(
        new IncompatibleVersion({
          message: `version ${to.version} removes or changes ${[...compat.removed, ...compat.changed].join(", ")}`,
        }),
      )
    : Result.succeed(compat);
}
