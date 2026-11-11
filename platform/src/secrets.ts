/**
 * A secret the platform holds. `reveal()` is the only read. JSON, string conversion and Node's
 * inspector print "[sealed]", so a log line or response body cannot carry the value by accident.
 */
export class Sealed {
  readonly #value: string;

  constructor(value: string) {
    this.#value = value;
  }

  reveal(): string {
    return this.#value;
  }

  toJSON() {
    return "[sealed]";
  }

  toString() {
    return "[sealed]";
  }

  [Symbol.for("nodejs.util.inspect.custom")]() {
    return "[sealed]";
  }
}

/** 32 random bytes, base64url. Used for secrets, IDs that act as capabilities, and OAuth state. */
export function randomToken(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
}
