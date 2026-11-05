import { Totem } from "@totem/sdk";
import { Schema } from "effect";

const person = {
  email: Schema.String,
  firstName: Schema.optionalKey(Schema.String),
  lastName: Schema.optionalKey(Schema.String),
};

const eventId = { eventId: Schema.String };

const Attendee = Schema.Struct({
  ...person,
  checkedIn: Schema.Boolean,
  crmContactId: Schema.NullOr(Schema.String),
});

const EventSummary = Schema.Struct({
  ...eventId,
  name: Schema.String,
  capacity: Schema.Int,
  seatsLeft: Schema.Int,
});

/** Input with only an event ID. */
const ByEvent = Schema.Struct(eventId);

export const manifest = Totem.Manifest({
  name: "events",
  version: "0.3.0",
  description: "Runs a tenant's events: registrations up to capacity, a waitlist and check-in. Syncs attendees to a CRM.",
  provides: {
    actions: {
      createEvent: {
        description: "Create an event with a fixed number of seats.",
        input: Schema.Struct({ name: Schema.String, capacity: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)) }),
        output: Schema.Struct(eventId),
      },
      listEvents: {
        description: "Every event of this install, oldest first.",
        input: Totem.Empty,
        output: Schema.Struct({ events: Schema.Array(EventSummary) }),
      },
      eventInfo: {
        description: "One event's name, capacity and seats left.",
        input: ByEvent,
        output: EventSummary,
      },
      register: {
        description: "Register an attendee, or waitlist them when the event is full. Registering twice returns the first result.",
        input: Schema.Struct({ ...eventId, ...person }),
        output: Schema.Struct({
          status: Schema.Literals(["registered", "waitlisted"]),
          /** 1-based place among the registered, or on the waitlist. */
          position: Schema.Int,
          /** Null when the CRM sync failed or no CRM is bound. */
          crmContactId: Schema.NullOr(Schema.String),
        }),
      },
      checkIn: {
        description: "Check in a registered attendee. False for waitlisted or unknown emails.",
        input: Schema.Struct({ ...eventId, email: Schema.String }),
        output: Schema.Struct({ checkedIn: Schema.Boolean }),
      },
      listAttendees: {
        description: "An event's registered attendees and waitlist, each in registration order.",
        input: ByEvent,
        output: Schema.Struct({ registered: Schema.Array(Attendee), waitlist: Schema.Array(Attendee) }),
      },
    },
  },
  needs: {
    state: true,
    actions: {
      // Bound to a CRM install, such as the hubspot example's upsertContact (ADR 0013).
      upsertContact: {
        description: "Create or update a CRM contact by email.",
        input: Schema.Struct(person),
        output: Schema.Struct({ contactId: Schema.String, created: Schema.Boolean }),
      },
    },
  },
});
