import { RpcError } from "@ipaas/protocol";

const RESERVED_MIN = -32768;
const RESERVED_MAX = -32000;

/**
 * Thrown by action handlers to report a failure the caller should see.
 * The code must sit outside the JSON-RPC reserved range.
 */
export class AppError extends RpcError {
  constructor(code: number, message: string, data?: unknown) {
    if (code >= RESERVED_MIN && code <= RESERVED_MAX) {
      throw new RangeError(`AppError code ${code} is inside the reserved JSON-RPC range`);
    }
    super(code, message, data);
    this.name = "AppError";
  }
}
