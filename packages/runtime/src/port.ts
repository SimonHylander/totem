import type { ActiveInstall } from "@totem/installs";
import { Context, type Effect } from "effect";
import type { AppFailed } from "./errors.js";
import type { CallDepth } from "./model.js";

/** Reaches an install's app. The platform provides it with signed HTTP calls and callback tokens. */
export class AppTransport extends Context.Service<
  AppTransport,
  {
    /** Run `action` on the install's app and return its output. The app answers ActionNotFound for actions it lacks. */
    readonly invoke: (install: ActiveInstall, action: string, input: unknown, depth: CallDepth) => Effect.Effect<unknown, AppFailed>;
  }
>()("@totem/runtime/AppTransport") {}
