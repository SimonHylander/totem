import { Context } from "effect";

export class PlatformConfig extends Context.Service<
  PlatformConfig,
  {
    readonly baseUrl: string;
    /** Accept `http://localhost` provider endpoints. Development only. */
    readonly allowLocalhost: boolean;
  }
>()("@totem/platform/PlatformConfig") {}
