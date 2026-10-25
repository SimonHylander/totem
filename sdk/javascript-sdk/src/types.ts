import type { FromSchema, JSONSchema } from "json-schema-to-ts";
import type { CredentialValueFor, LogLevel, Manifest, Signature } from "@totem/protocol";

// Everything here is derived from the manifest literal. Authors write the
// manifest once and get typed handlers, ports, credentials and config.

type Infer<S> = S extends JSONSchema ? FromSchema<S> : never;

type ActionDefs<M> = M extends { provides: { actions: infer A extends Record<string, Signature> } }
  ? A
  : Record<never, never>;

type PortDefs<M> = M extends { needs: { actions: infer P extends Record<string, Signature> } }
  ? P
  : Record<never, never>;

type CredentialNeeds<M> = M extends { needs: { credentials?: infer C } } ? NonNullable<C> : Record<never, never>;

/** Credential names mapped to the value `credentials/get` returns for each. */
export type Credentials<M> = { [K in keyof CredentialNeeds<M> & string]: CredentialValueFor<CredentialNeeds<M>[K]> };

type Config<M> = M extends { config: infer C extends JSONSchema } ? FromSchema<C> : Record<string, unknown>;

type InputOf<S> = S extends { input: infer I } ? Infer<I> : never;
type OutputOf<S> = S extends { output: infer O } ? Infer<O> : never;

export type ActionInput<M, K extends keyof ActionDefs<M>> = InputOf<ActionDefs<M>[K]>;
export type ActionOutput<M, K extends keyof ActionDefs<M>> = OutputOf<ActionDefs<M>[K]>;
export type ActionName<M> = keyof ActionDefs<M> & string;
export type PortName<M> = keyof PortDefs<M> & string;

/** Typed functions for each port in `needs.actions`. */
export type Ports<M> = {
  [K in keyof PortDefs<M>]: (input: InputOf<PortDefs<M>[K]>) => Promise<OutputOf<PortDefs<M>[K]>>;
};

type State = {
  get<T = unknown>(key: string): Promise<T | null>;
  set(key: string, value: unknown): Promise<void>;
};

type Logger = {
  [L in LogLevel]: (message: string, data?: Record<string, unknown>) => Promise<void>;
};

/** Only apps that declared `needs.state` get a state port. */
type StatePort<M> = M extends { needs: { state: true } } ? { state: State } : Record<never, never>;

/** Available in install and uninstall hooks. */
export type InstallCtx<M> = {
  tenantId: string;
  installId: string;
  config: Config<M>;
  credentials: { get<K extends keyof Credentials<M>>(name: K): Promise<Credentials<M>[K]> };
  log: Logger;
} & StatePort<M>;

/** Available in action handlers. */
export type CallCtx<M> = InstallCtx<M> & {
  callId: string;
  idempotencyKey?: string;
  deadline?: Date;
  ports: Ports<M>;
};

export type Handlers<M extends Manifest> = {
  actions: {
    [K in keyof ActionDefs<M>]: (input: ActionInput<M, K>, ctx: CallCtx<M>) => Promise<ActionOutput<M, K>>;
  };
  install?: (ctx: InstallCtx<M>) => Promise<void>;
  uninstall?: (ctx: InstallCtx<M>) => Promise<void>;
};
