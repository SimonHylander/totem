import { Schema } from "effect";

/** `can` refused, or a record belongs to another tenant or session. */
export class Forbidden extends Schema.TaggedError<Forbidden>()("Forbidden", { message: Schema.String }) {}
