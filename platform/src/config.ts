import { Context } from "effect";

/** Deployment settings every operation can read. */
export class PlatformConfig extends Context.Service<
  PlatformConfig,
  {
    /** The platform's public origin, such as `http://localhost:3000`. */
    readonly baseUrl: string;
    /** Accept `http://localhost` provider endpoints. Development only. */
    readonly allowLocalhost: boolean;
  }
>()("@totem/platform/PlatformConfig") {}
