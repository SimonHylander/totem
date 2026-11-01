import { Schema } from "effect";

/** An upgrade whose `compare` result is Breaking. */
export class IncompatibleVersion extends Schema.TaggedError<IncompatibleVersion>()("IncompatibleVersion", {
  message: Schema.String,
}) {}
