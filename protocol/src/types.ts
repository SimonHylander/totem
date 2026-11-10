import type { JSONSchema } from "json-schema-to-ts";
import { Predicate, Schema } from "effect";

export type { JSONSchema };

export const PROTOCOL_VERSION = "1";

export const parseOptions = { onExcessProperty: "error" } as const;

const JsonSchema = Schema.declare((value): value is JSONSchema => Predicate.isBoolean(value) || Predicate.isObject(value));

const Identifier = Schema.String.check(Schema.isPattern(/^[a-zA-Z][a-zA-Z0-9]*$/));

const Empty = Schema.Record(Schema.String, Schema.Never);

const JsonObject = Schema.Record(Schema.String, Schema.Unknown);

/** An action or a port: a named input/output pair. */
export const Signature = Schema.Struct({
  description: Schema.optionalKey(Schema.String),
  input: JsonSchema,
  output: JsonSchema,
});
export type Signature = typeof Signature.Type;

export const Trigger = Schema.Struct({
  description: Schema.optionalKey(Schema.String),
  payload: JsonSchema,
});
export type Trigger = typeof Trigger.Type;

/**
 * An https URL, or http on localhost for development. Mirrors `$defs/endpoint`. The template is
 * approximate, so the platform also parses each endpoint and checks the real hostname.
 */
export const Endpoint = Schema.Union([
  Schema.TemplateLiteral(["https://", Schema.String]),
  Schema.TemplateLiteral(["http://localhost:", Schema.String]),
  Schema.TemplateLiteral(["http://localhost/", Schema.String]),
]);
export type Endpoint = typeof Endpoint.Type;

/**
 * OAuth 2.0 authorization code grant. The app declares the provider's endpoints. The platform runs
 * consent, storage and refresh against them once an operator pins them (ADR 0012).
 */
export const OAuth2Need = Schema.Struct({
  type: Schema.Literal("oauth2"),
  authorizeUrl: Endpoint,
  /** Receives the client secret and refresh tokens. */
  tokenUrl: Endpoint,
  /** Sent space-separated. The tenant consents to exactly these. */
  scopes: Schema.Array(Schema.String),
});
export type OAuth2Need = typeof OAuth2Need.Type;

/** A static key the tenant enters when connecting. */
export const ApiKeyNeed = Schema.Struct({ type: Schema.Literal("apiKey") });
export type ApiKeyNeed = typeof ApiKeyNeed.Type;

/** One member per credential type, each with only its own fields. */
export const CredentialNeed = Schema.Union([OAuth2Need, ApiKeyNeed]);
export type CredentialNeed = typeof CredentialNeed.Type;

/** What an app provides and what it needs. Returned from `initialize`. */
export const Manifest = Schema.Struct({
  name: Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9-]*$/)),
  version: Schema.String,
  protocol: Schema.Literal(PROTOCOL_VERSION),
  description: Schema.optionalKey(Schema.String),
  provides: Schema.Struct({
    actions: Schema.optionalKey(Schema.Record(Identifier, Signature)),
    triggers: Schema.optionalKey(Schema.Record(Identifier, Trigger)),
  }),
  needs: Schema.Struct({
    credentials: Schema.optionalKey(Schema.Record(Identifier, CredentialNeed)),
    state: Schema.optionalKey(Schema.Boolean),
    actions: Schema.optionalKey(Schema.Record(Identifier, Signature)),
  }),
  config: Schema.optionalKey(JsonSchema),
});
export type Manifest = typeof Manifest.Type;

export const InstallContext = Schema.Struct({
  tenantId: Schema.String,
  installId: Schema.String,
  config: JsonObject,
});
export type InstallContext = typeof InstallContext.Type;

export const CallContext = Schema.Struct({
  ...InstallContext.fields,
  callId: Schema.String,
  idempotencyKey: Schema.optionalKey(Schema.String),
  deadline: Schema.optionalKey(Schema.String),
});
export type CallContext = typeof CallContext.Type;

export const CredentialValue = Schema.Union([
  Schema.Struct({ type: Schema.Literal("oauth2"), accessToken: Schema.String, expiresAt: Schema.String }),
  Schema.Struct({ type: Schema.Literal("apiKey"), key: Schema.String }),
]);
export type CredentialValue = typeof CredentialValue.Type;

/** The value `credentials/get` returns for a declared need. */
export type CredentialValueFor<N> = N extends { type: infer T } ? Extract<CredentialValue, { type: T }> : never;

export const LogLevel = Schema.Literals(["debug", "info", "warn", "error"]);
export type LogLevel = typeof LogLevel.Type;

export type MethodSchemas = {
  readonly [method: string]: {
    readonly params: Schema.Codec<unknown, unknown, never, never>;
    readonly result: Schema.Codec<unknown, unknown, never, never>;
  };
};

export type MethodTypes<T extends MethodSchemas> = {
  [K in keyof T]: { params: T[K]["params"]["Type"]; result: T[K]["result"]["Type"] };
};

const CallbackToken = Schema.String;

const StateVersion = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

/** Methods the platform calls on an app. */
export const AppMethods = {
  initialize: {
    params: Schema.Struct({ protocolVersion: Schema.String, platformUrl: Schema.String }),
    result: Schema.Struct({ manifest: Manifest }),
  },
  health: {
    params: Empty,
    result: Schema.Struct({ status: Schema.Literal("ok") }),
  },
  install: {
    params: Schema.Struct({ context: InstallContext, callbackToken: CallbackToken }),
    result: Empty,
  },
  uninstall: {
    params: Schema.Struct({ context: InstallContext, callbackToken: CallbackToken }),
    result: Empty,
  },
  "actions/invoke": {
    params: Schema.Struct({ action: Schema.String, input: Schema.Unknown, context: CallContext, callbackToken: CallbackToken }),
    result: Schema.Struct({ output: Schema.Unknown }),
  },
} satisfies MethodSchemas;
export type AppMethods = MethodTypes<typeof AppMethods>;

/** Methods an app calls on the platform with a callback token. Tenant and install come from the token. */
export const PlatformMethods = {
  "credentials/get": {
    params: Schema.Struct({ name: Schema.String }),
    result: CredentialValue,
  },
  "state/get": {
    params: Schema.Struct({ key: Schema.String }),
    /** `version` is 0 when the key is unset. */
    result: Schema.Struct({ value: Schema.Unknown, version: StateVersion }),
  },
  "state/set": {
    /** With `version`, the write applies only if the key is still at that version, and fails with StateConflict otherwise. */
    params: Schema.Struct({
      key: Schema.String,
      value: Schema.Unknown,
      version: Schema.optionalKey(StateVersion),
    }),
    result: Schema.Struct({ version: StateVersion }),
  },
  log: {
    params: Schema.Struct({ level: LogLevel, message: Schema.String, data: Schema.optionalKey(JsonObject) }),
    result: Empty,
  },
  "actions/invoke": {
    params: Schema.Struct({ port: Schema.String, input: Schema.Unknown }),
    result: Schema.Struct({ output: Schema.Unknown }),
  },
} satisfies MethodSchemas;
export type PlatformMethods = MethodTypes<typeof PlatformMethods>;

/** A public app as `apps/list` returns it. `actions` is its manifest's `provides.actions`. */
export const CatalogApp = Schema.Struct({
  appId: Schema.String,
  name: Schema.String,
  description: Schema.optionalKey(Schema.String),
  actions: Schema.Record(Schema.String, Signature),
});
export type CatalogApp = typeof CatalogApp.Type;

/** Whether a provider install holds a usable credential for one of its `needs.credentials`. */
export const CredentialStatus = Schema.Struct({ type: Schema.Literals(["oauth2", "apiKey"]), connected: Schema.Boolean });
export type CredentialStatus = typeof CredentialStatus.Type;

/** What one port is bound to, as `ports/list` returns it. */
export const BoundPort = Schema.Struct({
  appId: Schema.String,
  /** The provider's manifest name. */
  name: Schema.String,
  action: Schema.String,
  credentials: Schema.Record(Schema.String, CredentialStatus),
});
export type BoundPort = typeof BoundPort.Type;

/**
 * Methods an app calls on the platform signed with its HMAC secret, outside any call. Each names
 * one of the app's installs, which also picks the secret (ADR 0014, ADR 0015).
 */
export const SignedPlatformMethods = {
  "actions/start": {
    params: Schema.Struct({ installId: Schema.String, action: Schema.String, input: Schema.Unknown }),
    result: Schema.Struct({ output: Schema.Unknown }),
  },
  "apps/list": {
    params: Schema.Struct({ installId: Schema.String }),
    result: Schema.Struct({ apps: Schema.Array(CatalogApp) }),
  },
  "ports/list": {
    params: Schema.Struct({ installId: Schema.String }),
    result: Schema.Struct({ ports: Schema.Record(Schema.String, Schema.NullOr(BoundPort)) }),
  },
  "ports/bind": {
    params: Schema.Struct({ installId: Schema.String, port: Schema.String, appId: Schema.String, action: Schema.String }),
    result: Empty,
  },
  "ports/unbind": {
    params: Schema.Struct({ installId: Schema.String, port: Schema.String }),
    result: Empty,
  },
  "ports/connect": {
    params: Schema.Struct({ installId: Schema.String, port: Schema.String, credential: Schema.String, returnTo: Schema.String }),
    result: Schema.Struct({ url: Schema.String }),
  },
} satisfies MethodSchemas;
export type SignedPlatformMethods = MethodTypes<typeof SignedPlatformMethods>;

/** Protocol error codes. See protocol/README.md. */
export const ErrorCode = {
  ProtocolVersionUnsupported: -32000,
  NotDeclared: -32001,
  CredentialMissing: -32002,
  PortUnbound: -32003,
  ActionNotFound: -32004,
  Unauthorized: -32005,
  DeadlineExceeded: -32006,
  StateConflict: -32007,
  // JSON-RPC standard
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603,
  ParseError: -32700,
} as const;
