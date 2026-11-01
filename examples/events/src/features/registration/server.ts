import { createServerFn } from "@tanstack/react-start";
import { eventsInstall, totem } from "../../totem/connection.js";

// Server functions for the registration page. Each submit runs the app's `register` action
// through the platform, which syncs the attendee to the bound CRM.

type Registration = { eventId: string; email: string; firstName?: string; lastName?: string };

/** Server functions are public endpoints, so check their input before it reaches the platform. */
function text(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${field} is required`);
  return value.trim();
}

/** Checks a registration. The page runs it on submit too, so the attendee's line shows what is sent. */
export function registration(data: unknown): Registration {
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
  .handler(({ data: eventId }) => totem().client.start(eventsInstall(), "eventInfo", { eventId }));

export const registerAttendee = createServerFn({ method: "POST" })
  .validator(registration)
  .handler(({ data }) => totem().client.start(eventsInstall(), "register", data));
