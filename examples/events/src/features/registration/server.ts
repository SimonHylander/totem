import { createServerFn } from "@tanstack/react-start";
import { connectOnce, eventsInstall } from "../../totem/connection.js";

type Registration = { eventId: string; email: string; firstName?: string; lastName?: string };

/** Server functions are public endpoints, so check their input before it reaches the platform. */
function text(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${field} is required`);
  return value.trim();
}

export function parseRegistration(data: unknown): Registration {
  const { eventId, email, firstName, lastName } = (data ?? {}) as Record<string, unknown>;
  const optional = (value: unknown, field: string) => (value === undefined || value === "" ? undefined : text(value, field));
  const first = optional(firstName, "firstName");
  const last = optional(lastName, "lastName");
  return {
    eventId: text(eventId, "eventId"),
    email: text(email, "email"),
    ...(first !== undefined && { firstName: first }),
    ...(last !== undefined && { lastName: last }),
  };
}

export const getEvent = createServerFn({ method: "GET" })
  .validator((eventId: unknown) => text(eventId, "eventId"))
  .handler(({ data: eventId }) => connectOnce().client.start(eventsInstall(), "eventInfo", { eventId }));

export const registerAttendee = createServerFn({ method: "POST" })
  .validator(parseRegistration)
  .handler(({ data }) => connectOnce().client.start(eventsInstall(), "register", data));
