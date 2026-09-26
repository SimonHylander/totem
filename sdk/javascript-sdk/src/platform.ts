import { rpc, type CredentialValue, type LogLevel, type PlatformMethods } from "@ipaas/protocol";

/**
 * The driven port. Everything an app asks of the platform goes through here.
 * `platformClient` speaks the protocol; `fakePlatform` is the in-memory test double.
 */
export interface Platform {
  getCredential(name: string): Promise<CredentialValue>;
  getState(key: string): Promise<unknown>;
  setState(key: string, value: unknown): Promise<void>;
  log(level: LogLevel, message: string, data?: Record<string, unknown>): Promise<void>;
  invokePort(port: string, input: unknown): Promise<unknown>;
}

type ClientOptions = {
  url: string;
  token: string;
  fetch?: typeof fetch;
};

/** JSON-RPC client for platform methods, authenticated with a callback token. */
export function platformClient({ url, token, fetch: doFetch }: ClientOptions): Platform {
  const call = <M extends keyof PlatformMethods>(method: M, params: PlatformMethods[M]["params"]) =>
    rpc<PlatformMethods, M>(url, method, params, {
      headers: { authorization: `Bearer ${token}` },
      ...(doFetch && { fetch: doFetch }),
    });

  return {
    getCredential: (name) => call("credentials/get", { name }),
    getState: (key) => call("state/get", { key }).then((r) => r.value),
    setState: (key, value) => call("state/set", { key, value }).then(() => undefined),
    log: (level, message, data) => call("log", { level, message, data }).then(() => undefined),
    invokePort: (port, input) => call("actions/invoke", { port, input }).then((r) => r.output),
  };
}
