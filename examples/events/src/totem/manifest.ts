import type { Manifest } from "@totem/sdk";

const person = {
  email: { type: "string" },
  firstName: { type: "string" },
  lastName: { type: "string" },
} as const;

const eventId = { eventId: { type: "string" } } as const;

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

const eventSummary = {
  type: "object",
  required: ["eventId", "name", "capacity", "seatsLeft"],
  properties: {
    ...eventId,
    name: { type: "string" },
    capacity: { type: "integer" },
    seatsLeft: { type: "integer" },
  },
  additionalProperties: false,
} as const;

const byEvent = { type: "object", required: ["eventId"], properties: eventId, additionalProperties: false } as const;

export const manifest = {
  name: "events",
  version: "0.2.0",
  protocol: "1",
  description: "Runs a tenant's events: registrations up to capacity, a waitlist, and check-in. Syncs attendees to a CRM.",
  provides: {
    actions: {
      createEvent: {
        description: "Create an event with a fixed number of seats.",
        input: {
          type: "object",
          required: ["name", "capacity"],
          properties: { name: { type: "string" }, capacity: { type: "integer", minimum: 1 } },
          additionalProperties: false,
        },
        output: { type: "object", required: ["eventId"], properties: eventId, additionalProperties: false },
      },
      listEvents: {
        description: "List every event of this install, oldest first.",
        input: { type: "object", additionalProperties: false },
        output: {
          type: "object",
          required: ["events"],
          properties: { events: { type: "array", items: eventSummary } },
          additionalProperties: false,
        },
      },
      eventInfo: {
        description: "Get one event's name, capacity, and seats left.",
        input: byEvent,
        output: eventSummary,
      },
      register: {
        description: "Register an attendee, or waitlist them when the event is full. Registering twice returns the first result.",
        input: { type: "object", required: ["eventId", "email"], properties: { ...eventId, ...person }, additionalProperties: false },
        output: {
          type: "object",
          required: ["status", "position", "crmContactId"],
          properties: {
            status: { enum: ["registered", "waitlisted"] },
            /** 1-based position among registered attendees, or on the waitlist. */
            position: { type: "integer" },
            /** Null when the CRM sync failed or no CRM is bound. */
            crmContactId: { type: ["string", "null"] },
          },
          additionalProperties: false,
        },
      },
      checkIn: {
        description: "Check in a registered attendee. Returns false for a waitlisted or unknown email.",
        input: {
          type: "object",
          required: ["eventId", "email"],
          properties: { ...eventId, email: { type: "string" } },
          additionalProperties: false,
        },
        output: {
          type: "object",
          required: ["checkedIn"],
          properties: { checkedIn: { type: "boolean" } },
          additionalProperties: false,
        },
      },
      listAttendees: {
        description: "List an event's registered attendees and waitlist, each in registration order.",
        input: byEvent,
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
} as const satisfies Manifest;
