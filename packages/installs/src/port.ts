import type { InstallId } from "@totem/ids";
import { Context, type Effect } from "effect";
import type { InstallCore } from "./model.js";

/** Where installs are stored. The platform provides it. */
export class InstallRepo extends Context.Service<
  InstallRepo,
  {
    /** The install, or undefined when there is none. */
    readonly lookup: (id: InstallId) => Effect.Effect<InstallCore | undefined>;
  }
>()("@totem/installs/InstallRepo") {}
