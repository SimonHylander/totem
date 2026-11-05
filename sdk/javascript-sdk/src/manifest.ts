import { PROTOCOL_VERSION, type CredentialNeed, type Signature } from "@totem/protocol";
import { Schema } from "effect";

type JsonSchema = Signature["input"];

/** A schema the SDK can run with no services of its own. */
export type JsonCodec = Schema.Codec<unknown, unknown, never, never>;

/** Holds the Effect schemas behind a wire schema. A symbol, so it never reaches the wire. */
export const codecs: unique symbol = Symbol("totem/codecs");

/** Closed and agreed between the validator and the wire: an unknown key fails, and the JSON Schema says so. */
export const parseOptions = { onExcessProperty: "error" } as const;

/** An object with no keys. `Schema.Struct({})` is not one: it accepts anything but null. */
export const Empty = Schema.Record(Schema.String, Schema.Never);

type ActionDefinition = { readonly description?: string; readonly input: JsonCodec; readonly output: JsonCodec };
type ActionDefinitions = Record<string, ActionDefinition>;
type Credentials = Record<string, CredentialNeed>;

export type TypedSignature<I extends JsonCodec, O extends JsonCodec> = Signature & {
  readonly [codecs]: { readonly input: I; readonly output: O };
};

type TypedSignatures<A> = {
  readonly [K in keyof A]: A[K] extends { readonly input: infer I extends JsonCodec; readonly output: infer O extends JsonCodec }
    ? TypedSignature<I, O>
    : never;
};

type Lower = "a" | "b" | "c" | "d" | "e" | "f" | "g" | "h" | "i" | "j" | "k" | "l" | "m" | "n" | "o" | "p" | "q" | "r" | "s" | "t" | "u" | "v" | "w" | "x" | "y" | "z";
type Digit = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9";
type Letter = Lower | Uppercase<Lower>;

type Every<S extends string, C extends string> = S extends `${infer H}${infer R}` ? (H extends C ? Every<R, C> : false) : true;
type StartsWith<S extends string, C extends string> = S extends `${infer H}${string}` ? (H extends C ? true : false) : false;

type IsName<S extends string> = StartsWith<S, Lower> extends true ? Every<S, Lower | Digit | "-"> : false;
type IsIdentifier<S extends string> = StartsWith<S, Letter> extends true ? Every<S, Letter | Digit> : false;

type AppName<S extends string> = IsName<S> extends true ? S : `name must match ^[a-z][a-z0-9-]*$, got ${S}`;
type Semver<S extends string> = S extends `${number}.${number}.${number}${"" | `-${string}` | `+${string}`}` ? S : `version must be semver, got ${S}`;

type KeysOfAny<U> = U extends unknown ? keyof U : never;

/** Rejects unknown keys and bad names inside a map the type parameter was inferred from. */
type Checked<A, D> = {
  readonly [K in keyof A]: IsIdentifier<K & string> extends true
    ? A[K] & { readonly [X in Exclude<keyof A[K], KeysOfAny<D>>]: never }
    : `name must match ^[a-zA-Z][a-zA-Z0-9]*$, got ${K & string}`;
};

type ConfigOf<C> = [C] extends [JsonCodec] ? { readonly config: JsonSchema; readonly [codecs]: { readonly config: C } } : unknown;

/** The wire manifest `Manifest` returns, with the schemas behind each signature. */
export type ManifestOf<Name, Version, Provided, Ports, Needed, State, Config> = {
  readonly name: Name;
  readonly version: Version;
  readonly protocol: typeof PROTOCOL_VERSION;
  readonly description?: string;
  readonly provides: { readonly actions: TypedSignatures<Provided> };
  readonly needs: { readonly state: State; readonly credentials: Needed; readonly actions: TypedSignatures<Ports> };
} & ConfigOf<Config>;

function jsonSchemaOf(schema: JsonCodec, where: string): JsonSchema {
  const { schema: root, definitions } = Schema.toJsonSchemaDocument(schema, parseOptions);
  if ("not" in root) throw new TypeError(`${where} accepts anything but null. For an empty object use Totem.Empty.`);
  const document = Object.keys(definitions).length > 0 ? { ...root, $defs: definitions } : root;
  // Effect types a document as an open record. Every document it emits is a JSON Schema object.
  return document as JsonSchema;
}

function signatures(definitions: ActionDefinitions, where: string) {
  return Object.fromEntries(
    Object.entries(definitions).map(([name, { description, input, output }]) => [
      name,
      Object.defineProperty(
        {
          ...(description !== undefined && { description }),
          input: jsonSchemaOf(input, `${where}.${name}.input`),
          output: jsonSchemaOf(output, `${where}.${name}.output`),
        },
        codecs,
        { value: { input, output } },
      ),
    ]),
  );
}

/**
 * Declare what an app provides and needs. Schemas are Effect schemas: handlers get their decoded
 * types, calls are validated against them, and the wire carries the JSON Schema they emit (ADR 0019).
 */
export function Manifest<
  const Name extends string,
  const Version extends string,
  const Provided extends ActionDefinitions = Record<never, never>,
  const Ports extends ActionDefinitions = Record<never, never>,
  const Needed extends Credentials = Record<never, never>,
  const State extends boolean = false,
  Config extends JsonCodec = never,
>(definition: {
  readonly name: AppName<Name>;
  readonly version: Semver<Version>;
  readonly description?: string;
  readonly provides?: { readonly actions?: Provided & Checked<Provided, ActionDefinition> };
  readonly needs?: {
    readonly state?: State;
    readonly credentials?: Needed & Checked<Needed, CredentialNeed>;
    readonly actions?: Ports & Checked<Ports, ActionDefinition>;
  };
  readonly config?: Config;
}): ManifestOf<Name, Version, Provided, Ports, Needed, State, Config> {
  const { name, version, description, provides, needs, config } = definition;
  const manifest = {
    name,
    version,
    protocol: PROTOCOL_VERSION,
    ...(description !== undefined && { description }),
    provides: { actions: signatures(provides?.actions ?? {}, "provides.actions") },
    needs: {
      state: needs?.state ?? false,
      credentials: needs?.credentials ?? {},
      actions: signatures(needs?.actions ?? {}, "needs.actions"),
    },
    ...(config !== undefined && { config: jsonSchemaOf(config, "config") }),
  };
  if (config !== undefined) Object.defineProperty(manifest, codecs, { value: { config } });
  // The object above is built from the same definition this signature describes, key by key.
  return manifest as never;
}
