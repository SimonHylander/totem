import { ErrorCode, RpcError, type CredentialValue, type LogLevel, type Manifest } from "@totem/protocol";
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
  const logs: LogEntry[] = [];
  const portCalls: PortCall[] = [];
  const credentialLookup = credentials as Record<string, CredentialValue | undefined>;
  const portLookup = ports as Record<string, ((input: unknown) => Promise<unknown>) | undefined>;

  const assertDeclared = (declared: boolean, what: string) => {
    if (!declared) throw new RpcError(ErrorCode.NotDeclared, `${what} is not declared in the manifest`);
  };

  return {
    state,
    logs,
    portCalls,

    async getCredential(name) {
      assertDeclared(name in (manifest.needs.credentials ?? {}), `credential "${name}"`);
      const value = credentialLookup[name];
      if (!value) throw new RpcError(ErrorCode.CredentialMissing, `credential "${name}" is not connected`);
      return value;
    },

    async getState(key) {
      assertDeclared(manifest.needs.state === true, "state");
      return state.get(key) ?? null;
    },

    async setState(key, value) {
      assertDeclared(manifest.needs.state === true, "state");
      if (value === null) state.delete(key);
      else state.set(key, value);
    },

    async log(level, message, data) {
      logs.push(data === undefined ? { level, message } : { level, message, data });
    },

    async invokePort(port, input) {
      assertDeclared(port in (manifest.needs.actions ?? {}), `port "${port}"`);
      const handler = portLookup[port];
      if (!handler) throw new RpcError(ErrorCode.PortUnbound, `port "${port}" has no fake bound`);
      portCalls.push({ port, input });
      return handler(input);
    },
  };
}
