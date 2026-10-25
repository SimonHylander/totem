import type { Manifest } from "@totem/sdk";

const person = {
  email: { type: "string" },
  firstName: { type: "string" },
  lastName: { type: "string" },
} as const;

const attendee = {
  type: "object",
  required: ["email", "checkedIn", "crmContactId"],
  properties: {
    ...person,
    checkedIn: { type: "boolean" },
    crmContactId: { type: ["string", "null"] },
  },
  additionalProperties: false,
} as const;

export const manifest = {
  name: "events",
  version: "0.1.0",
  protocol: "1",
  description: "Runs one event: registrations up to capacity, a waitlist and check-in. Syncs attendees to a CRM.",
  provides: {
    actions: {
      register: {
        description: "Register an attendee, or waitlist them when the event is full. Registering twice returns the first result.",
        input: { type: "object", required: ["email"], properties: person, additionalProperties: false },
        output: {
          type: "object",
          required: ["status", "position", "crmContactId"],
          properties: {
            status: { enum: ["registered", "waitlisted"] },
            /** 1-based place among the registered, or on the waitlist. */
            position: { type: "integer" },
            /** Null when the CRM sync failed or no CRM is bound. */
            crmContactId: { type: ["string", "null"] },
          },
          additionalProperties: false,
        },
      },
      checkIn: {
        description: "Check in a registered attendee. False for waitlisted or unknown emails.",
        input: { type: "object", required: ["email"], properties: { email: { type: "string" } }, additionalProperties: false },
        output: {
          type: "object",
          required: ["checkedIn"],
          properties: { checkedIn: { type: "boolean" } },
          additionalProperties: false,
        },
      },
      eventInfo: {
        description: "The event's name, capacity and seats left, for display.",
        input: { type: "object", additionalProperties: false },
        output: {
          type: "object",
          required: ["eventName", "capacity", "seatsLeft"],
          properties: {
            eventName: { type: "string" },
            capacity: { type: "integer" },
            seatsLeft: { type: "integer" },
          },
          additionalProperties: false,
        },
      },
      listAttendees: {
        description: "Registered attendees and the waitlist, each in registration order.",
        input: { type: "object", additionalProperties: false },
        output: {
          type: "object",
          required: ["registered", "waitlist"],
          properties: {
            registered: { type: "array", items: attendee },
            waitlist: { type: "array", items: attendee },
          },
          additionalProperties: false,
        },
      },
    },
  },
  needs: {
    state: true,
    actions: {
      // Bound to a CRM install, such as the hubspot example's upsertContact (ADR 0013).
      upsertContact: {
        description: "Create or update a CRM contact by email.",
        input: { type: "object", required: ["email"], properties: person, additionalProperties: false },
        output: {
          type: "object",
          required: ["contactId", "created"],
          properties: { contactId: { type: "string" }, created: { type: "boolean" } },
          additionalProperties: false,
        },
      },
    },
  },
  config: {
    type: "object",
    required: ["eventName", "capacity"],
    properties: {
      eventName: { type: "string" },
      capacity: { type: "integer", minimum: 1 },
    },
    additionalProperties: false,
  },
} as const satisfies Manifest;
