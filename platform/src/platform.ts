import { Layer, ManagedRuntime, Schema } from "effect";
import { FetchHttpClient } from "effect/http";
import { Principal } from "@totem/permissions";
import { Access, hashToken } from "./access/access.js";
import { appTransportLayer } from "./app-calls/app-calls.js";
import { Apps } from "./apps/apps.js";
import { CallbackKey } from "./app-calls/callback-token.js";
import { PlatformConfig } from "./config.js";
import { Connections } from "./connections/connections.js";
import { handleRequest } from "./http/handle.js";
import { Installs, installRepoLayer } from "./installs/installs.js";

export type PlatformOptions = {
  /** The platform's public origin, such as `http://localhost:3000`. */
  baseUrl: string;
  /** Management tokens and who holds them. Decoded when the platform starts. */
  principals: { token: string; principal: typeof Principal.Encoded }[];
  allowLocalhost?: boolean;
  fetch?: typeof fetch;
};

/** The services every operation runs with. `fetch` reaches apps, and OAuth providers through HttpClient. */
export function platformLayer({ baseUrl, principals, allowLocalhost = false, fetch }: PlatformOptions) {
  const apiTokens = new Map(principals.map(({ token, principal }) => [hashToken(token), Schema.decodeUnknownSync(Principal)(principal)]));
  const base = Layer.mergeAll(
    Apps.layer,
    Access.layer(apiTokens),
    CallbackKey.layer,
    Installs.layer,
    Layer.succeed(PlatformConfig, { baseUrl, allowLocalhost }),
    FetchHttpClient.layer,
    fetch ? Layer.succeed(FetchHttpClient.Fetch, fetch) : Layer.empty,
  );
  return Layer.provideMerge(Layer.mergeAll(installRepoLayer, appTransportLayer, Connections.layer), base);
}

/** What `platformLayer` provides, and so what every route, platform method and page may use. */
export type Services = Layer.Success<ReturnType<typeof platformLayer>>;

/**
 * Build the platform. `handle` serves the management API, the browser pages and the platform-methods
 * endpoint. `layer` adds or replaces services, such as a TestClock. `runtime` runs effects against
 * the same services, which tests use to drive the clock.
 */
export function createPlatform<R = never>(options: PlatformOptions, layer: Layer.Layer<R> = Layer.empty as Layer.Layer<R>) {
  const runtime = ManagedRuntime.make(Layer.merge(platformLayer(options), layer));
  // eslint-disable-next-line no-restricted-syntax -- the fetch-style handler servers call
  const handle = (request: Request): Promise<Response> => runtime.runPromise(handleRequest(request));
  return { handle, runtime };
}
