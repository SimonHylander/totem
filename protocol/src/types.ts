import type { JSONSchema } from "json-schema-to-ts";

// Hand-written mirrors of the JSON Schemas in this folder. Keep them in sync.
// TypeScript reads manifests at compile time through `as const`, so the
// manifest type must accept literal schemas. Codegen is for Python and Go.

export const PROTOCOL_VERSION = "1";

/** An action or a port: a named input/output pair. */
export type Signature = {
  description?: string;
  input: JSONSchema;
  output: JSONSchema;
};

export type Trigger = {
  description?: string;
  payload: JSONSchema;
};

export type CredentialNeed = {
  type: "oauth2" | "apiKey";
  scopes?: readonly string[];
};

/** What an app provides and what it needs. Returned from `initialize`. */
export type Manifest = {
  name: string;
  version: string;
  protocol: typeof PROTOCOL_VERSION;
  description?: string;
  provides: {
    actions?: Record<string, Signature>;
    triggers?: Record<string, Trigger>;
  };
  needs: {
    credentials?: Record<string, CredentialNeed>;
    state?: boolean;
    actions?: Record<string, Signature>;
  };
  config?: JSONSchema;
};

export type InstallContext = {
  tenantId: string;
  installId: string;
  config: Record<string, unknown>;
};

export type CallContext = InstallContext & {
  callId: string;
  idempotencyKey?: string;
  deadline?: string;
};

export type CredentialValue =
  | { type: "oauth2"; accessToken: string; expiresAt: string }
  | { type: "apiKey"; key: string };

export type LogLevel = "debug" | "info" | "warn" | "error";

/** Methods the platform calls on an app. */
export type AppMethods = {
  initialize: {
    params: { protocolVersion: typeof PROTOCOL_VERSION; platformUrl: string };
    result: { manifest: Manifest };
  };
  health: {
    params: Record<string, never>;
    result: { status: "ok" };
  };
  install: {
    params: { context: InstallContext; callbackToken: string };
    result: Record<string, never>;
  };
  uninstall: {
    params: { context: InstallContext; callbackToken: string };
    result: Record<string, never>;
  };
  "actions/invoke": {
    params: { action: string; input: unknown; context: CallContext; callbackToken: string };
    result: { output: unknown };
  };
};

/** Methods an app calls on the platform. Tenant and install come from the bearer token. */
export type PlatformMethods = {
  "credentials/get": {
    params: { name: string };
    result: CredentialValue;
  };
  "state/get": {
    params: { key: string };
    result: { value: unknown };
  };
  "state/set": {
    params: { key: string; value: unknown };
    result: Record<string, never>;
  };
  log: {
    params: { level: LogLevel; message: string; data?: Record<string, unknown> };
    result: Record<string, never>;
  };
  "actions/invoke": {
    params: { port: string; input: unknown };
    result: { output: unknown };
  };
};

/** Protocol error codes. See protocol/README.md. */
export const ErrorCode = {
  ProtocolVersionUnsupported: -32000,
  NotDeclared: -32001,
  CredentialMissing: -32002,
  PortUnbound: -32003,
  ActionNotFound: -32004,
  Unauthorized: -32005,
  DeadlineExceeded: -32006,
  // JSON-RPC standard
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603,
  ParseError: -32700,
} as const;
