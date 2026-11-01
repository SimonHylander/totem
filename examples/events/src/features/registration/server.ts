import { createServerFn } from "@tanstack/react-start";
import { Option, Schema, SchemaTransformation, identity } from "effect";
import { eventsInstall, totem } from "../../totem/connection.js";

const Text = Schema.Trim.check(Schema.isNonEmpty());

const OptionalText = Schema.optional(Schema.String).pipe(
  Schema.decodeTo(
    Schema.optionalKey(Text),
    SchemaTransformation.transformOptional<string, string | undefined>({
      decode: Option.filter((value): value is string => value !== undefined && value !== ""),
      encode: identity,
    }),
  ),
);

/** A registration. The page decodes with it on submit too, so the attendee's line shows what is sent. */
export const Registration = Schema.Struct({ eventId: Text, email: Text, firstName: OptionalText, lastName: OptionalText });

export const getEvent = createServerFn({ method: "GET" })
  .validator(Schema.toStandardSchemaV1(Text))
  .handler(({ data: eventId }) => totem().client.start(eventsInstall(), "eventInfo", { eventId }));

export const registerAttendee = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(Registration))
  .handler(({ data }) => totem().client.start(eventsInstall(), "register", data));
