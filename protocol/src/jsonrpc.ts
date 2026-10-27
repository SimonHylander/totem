import type { TraceMetadata } from "./trace.js";

export type JsonRpcId = string | number | null;

export type JsonRpcRequest = {
  jsonrpc: "2.0";
  id: JsonRpcId;
  method: string;
  params?: unknown;
  /** Unvalidated until `parseTrace` reads it (ADR 0016). */
  trace?: unknown;
};

export type JsonRpcErrorObject = {
  code: number;
  message: string;
  data?: unknown;
};

export type JsonRpcResponse =
  | { jsonrpc: "2.0"; id: JsonRpcId; result: unknown }
  | { jsonrpc: "2.0"; id: JsonRpcId; error: JsonRpcErrorObject };

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

/** A method table: `{ [method]: { params, result } }`. */
type MethodTable = Record<string, { params: unknown; result: unknown }>;

type RpcOptions = {
  headers?: Record<string, string>;
  /** Headers computed from the exact request body, such as `X-Totem-Signature`. */
  sign?: (body: string) => Promise<Record<string, string>>;
  fetch?: typeof fetch;
  /** The span this request continues. It goes in the body, so `sign` covers it. */
  trace?: TraceMetadata;
};

/**
 * Send one JSON-RPC request and return its result. Throws `RpcError` for a
 * JSON-RPC error and a plain `Error` for transport failures.
 */
export async function rpc<T extends MethodTable, M extends keyof T & string>(
  url: string,
  method: M,
  params: T[M]["params"],
  { headers = {}, sign, fetch: doFetch = fetch, trace }: RpcOptions = {},
): Promise<T[M]["result"]> {
  const request: JsonRpcRequest = { jsonrpc: "2.0", id: crypto.randomUUID(), method, params, ...(trace && { trace }) };
  const body = JSON.stringify(request);
  const response = await doFetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers, ...(await sign?.(body)) },
    body,
  });
  const reply = (await response.json()) as JsonRpcResponse;
  if ("error" in reply) {
    throw new RpcError(reply.error.code, reply.error.message, reply.error.data);
  }
  if (!response.ok) {
    throw new Error(`rpc ${method}: HTTP ${response.status}`);
  }
  return reply.result as T[M]["result"];
}

export function isJsonRpcRequest(value: unknown): value is JsonRpcRequest {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as JsonRpcRequest).jsonrpc === "2.0" &&
    typeof (value as JsonRpcRequest).method === "string"
  );
}
