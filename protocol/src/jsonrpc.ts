import { Option, Result, Schema } from "effect";
import type { TraceMetadata } from "./trace.js";
import { ErrorCode, parseOptions, type MethodSchemas, type MethodTypes } from "./types.js";

export const JsonRpcId = Schema.Union([Schema.String, Schema.Number, Schema.Null]);
export type JsonRpcId = typeof JsonRpcId.Type;

export const JsonRpcRequest = Schema.Struct({
  jsonrpc: Schema.Literal("2.0"),
  id: JsonRpcId,
  method: Schema.String,
  params: Schema.optionalKey(Schema.Unknown),
  /** Unvalidated until `parseTrace` reads it (ADR 0016). */
  trace: Schema.optionalKey(Schema.Unknown),
});
export type JsonRpcRequest = typeof JsonRpcRequest.Type;

export const JsonRpcErrorObject = Schema.Struct({
  code: Schema.Number,
  message: Schema.String,
  data: Schema.optionalKey(Schema.Unknown),
});
export type JsonRpcErrorObject = typeof JsonRpcErrorObject.Type;

export const JsonRpcResponse = Schema.Union([
  Schema.Struct({ jsonrpc: Schema.Literal("2.0"), id: JsonRpcId, result: Schema.Unknown }),
  Schema.Struct({ jsonrpc: Schema.Literal("2.0"), id: JsonRpcId, error: JsonRpcErrorObject }),
]);
export type JsonRpcResponse = typeof JsonRpcResponse.Type;

/** A JSON-RPC error received from, or to be sent to, the other side. */
export class RpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data?: unknown,
  ) {
    super(message);
    this.name = "RpcError";
  }

  toJSON(): JsonRpcErrorObject {
    return this.data === undefined
      ? { code: this.code, message: this.message }
      : { code: this.code, message: this.message, data: this.data };
  }
}

type RpcOptions = {
  headers?: Record<string, string>;
  /** Headers computed from the exact request body, such as `X-Totem-Signature`. */
  sign?: (body: string) => Promise<Record<string, string>>;
  fetch?: typeof fetch;
  /** The span this request continues. It goes in the body, so `sign` covers it. */
  trace?: TraceMetadata;
};

/**
 * Send one JSON-RPC request to a method of `methods` and return its result, decoded with the
 * method's schema. Throws `RpcError` for a JSON-RPC error, `Schema.SchemaError` for a result the
 * schema rejects, and a plain `Error` for transport failures.
 */
export async function rpc<T extends MethodSchemas, M extends keyof T & string>(
  url: string,
  methods: T,
  method: M,
  params: MethodTypes<T>[M]["params"],
  { headers = {}, sign, fetch: doFetch = fetch, trace }: RpcOptions = {},
): Promise<MethodTypes<T>[M]["result"]> {
  const request: JsonRpcRequest = { jsonrpc: "2.0", id: crypto.randomUUID(), method, params, ...(trace && { trace }) };
  const body = JSON.stringify(request);
  const response = await doFetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers, ...(await sign?.(body)) },
    body,
  });
  const reply = Option.getOrUndefined(Schema.decodeUnknownOption(JsonRpcResponse)(await response.json()));
  if (reply && "error" in reply) {
    throw new RpcError(reply.error.code, reply.error.message, reply.error.data);
  }
  if (!response.ok) {
    throw new Error(`rpc ${method}: HTTP ${response.status}`);
  }
  if (!reply) {
    throw new Error(`rpc ${method}: not a JSON-RPC 2.0 response`);
  }
  return Schema.decodeUnknownSync(methods[method]!.result, parseOptions)(reply.result);
}

/** Decode a method's params as they come off the wire. A mismatch is an InvalidParams `RpcError`. */
export function decodeParams<T extends MethodSchemas, M extends keyof T & string>(
  methods: T,
  method: M,
  params: unknown,
): Result.Result<MethodTypes<T>[M]["params"], RpcError> {
  return Result.mapError(
    Schema.decodeUnknownResult(methods[method]!.params, parseOptions)(params),
    (error) => new RpcError(ErrorCode.InvalidParams, error.message),
  );
}
