import { rpc, type PlatformMethods, type TraceMetadata } from "@totem/protocol";

/**
 * The driven port. Everything an app asks of the platform is one of the protocol's
 * `PlatformMethods`, so a new platform method needs no change here.
 * `platformClient` speaks the protocol; `fakePlatform` is the in-memory test double.
 */
export type Platform = {
  call<K extends keyof PlatformMethods>(method: K, params: PlatformMethods[K]["params"]): Promise<PlatformMethods[K]["result"]>;
};

export type ClientOptions = {
  url: string;
  token: string;
  fetch?: typeof fetch;
  /** Sent on every request as the span the call runs in (ADR 0016). */
  trace?: TraceMetadata;
};

/** JSON-RPC client for platform methods, authenticated with a callback token. */
export function platformClient({ url, token, fetch: doFetch, trace }: ClientOptions): Platform {
  return {
    call: (method, params) =>
      rpc<PlatformMethods, typeof method>(url, method, params, {
        headers: { authorization: `Bearer ${token}` },
        ...(doFetch && { fetch: doFetch }),
        ...(trace && { trace }),
      }),
  };
}
