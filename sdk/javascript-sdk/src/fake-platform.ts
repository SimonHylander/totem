import {
  ErrorCode,
  RpcError,
  isJsonRpcRequest,
  type CredentialValue,
  type JsonRpcResponse,
  type LogLevel,
  type Manifest,
  type PlatformMethods,
} from "@totem/protocol";
import type { Platform } from "./platform.js";
import type { Credentials, Ports } from "./types.js";

type FakeOptions<M> = {
  credentials?: Partial<Credentials<M>>;
  state?: Record<string, unknown>;
  ports?: Partial<Ports<M>>;
};

export type LogEntry = { level: LogLevel; message: string; data?: Record<string, unknown> };
export type PortCall = { port: string; input: unknown };

export type FakePlatform = Platform & {
  state: Map<string, unknown>;
  logs: LogEntry[];
  portCalls: PortCall[];
  /** Serves the platform methods over JSON-RPC, so `createHandler` can call this fake as it would the platform. */
  fetch: typeof fetch;
};

/**
 * In-memory platform for tests. Enforces the manifest the same way the real
 * platform does: undeclared credentials, state or ports are rejected.
 */
export function fakePlatform<M extends Manifest>(
  { manifest }: { manifest: M },
  { credentials = {}, state: initialState = {}, ports = {} }: FakeOptions<M> = {},
): FakePlatform {
  const state = new Map(Object.entries(initialState));
  // Versions as the platform gives them: one counter, so a key never gets back a version it had.
  let clock = 0;
  const versions = new Map([...state.keys()].map((key) => [key, ++clock]));
  const logs: LogEntry[] = [];
  const portCalls: PortCall[] = [];
  const credentialLookup = credentials as Record<string, CredentialValue | undefined>;
  const portLookup = ports as Record<string, ((input: unknown) => Promise<unknown>) | undefined>;

  const assertDeclared = (declared: boolean, what: string) => {
    if (!declared) throw new RpcError(ErrorCode.NotDeclared, `${what} is not declared in the manifest`);
  };

  const methods: { [K in keyof PlatformMethods]: (params: PlatformMethods[K]["params"]) => Promise<PlatformMethods[K]["result"]> } = {
    async "credentials/get"({ name }) {
      assertDeclared(name in (manifest.needs.credentials ?? {}), `credential "${name}"`);
      const value = credentialLookup[name];
      if (!value) throw new RpcError(ErrorCode.CredentialMissing, `credential "${name}" is not connected`);
      return value;
    },

    async "state/get"({ key }) {
      assertDeclared(manifest.needs.state === true, "state");
      return { value: state.get(key) ?? null, version: versions.get(key) ?? 0 };
    },

    async "state/set"({ key, value, version }) {
      assertDeclared(manifest.needs.state === true, "state");
      const current = versions.get(key) ?? 0;
      if (version !== undefined && version !== current) {
        throw new RpcError(ErrorCode.StateConflict, `state "${key}" is at version ${current}, not ${version}`);
      }
      clock++;
      if (value === null) {
        state.delete(key);
        versions.delete(key);
        return { version: 0 };
      }
      state.set(key, value);
      versions.set(key, clock);
      return { version: clock };
    },

    async log({ level, message, data }) {
      logs.push(data === undefined ? { level, message } : { level, message, data });
      return {};
    },

    async "actions/invoke"({ port, input }) {
      assertDeclared(port in (manifest.needs.actions ?? {}), `port "${port}"`);
      const handler = portLookup[port];
      if (!handler) throw new RpcError(ErrorCode.PortUnbound, `port "${port}" has no fake bound`);
      portCalls.push({ port, input });
      return { output: await handler(input) };
    },
  };

  const call: Platform["call"] = (method, params) => methods[method](params);
  const isMethod = (name: string): name is keyof PlatformMethods => name in methods;

  const fetch: typeof globalThis.fetch = async (_url, init) => {
    const request: unknown = JSON.parse(String(init?.body));
    if (!isJsonRpcRequest(request) || !isMethod(request.method)) {
      throw new Error(`fakePlatform: not a platform method request: ${String(init?.body)}`);
    }
    let response: JsonRpcResponse;
    try {
      // Params come off the wire unchecked, as in `createHandler`.
      response = { jsonrpc: "2.0", id: request.id, result: await call(request.method, request.params as never) };
    } catch (error) {
      if (!(error instanceof RpcError)) throw error;
      response = { jsonrpc: "2.0", id: request.id, error: error.toJSON() };
    }
    return Response.json(response);
  };

  return { state, logs, portCalls, call, fetch };
}
