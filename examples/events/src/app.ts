import { AppError, defineApp, type CallCtx } from "@totem/sdk";
import { manifest } from "./manifest.js";

// One install serves one tenant, and the tenant runs many events through it. Each event lives in
// install state under `event:<id>`, and `events` lists the IDs oldest first. State has no
// compare-and-set, so two calls that land at the same moment read the same event and the second
// write wins: an attendee can be lost and the last seat can be given twice.

type Attendee = {
  email: string;
  firstName?: string;
  lastName?: string;
  status: "registered" | "waitlisted";
  checkedIn: boolean;
  crmContactId: string | null;
};

type Event = { id: string; name: string; capacity: number; attendees: Attendee[] };

/** `eventInfo`, `register` and friends answer this for an event ID the install does not have. */
export const EVENT_NOT_FOUND = 2001;

type State = CallCtx<typeof manifest>["state"];

const EVENTS = "events";
const eventKey = (id: string) => `event:${id}`;

async function loadEvent(state: State, id: string): Promise<Event> {
  const event = await state.get<Event>(eventKey(id));
  if (!event) throw new AppError(EVENT_NOT_FOUND, `no event ${id}`);
  return event;
}

const saveEvent = (state: State, event: Event) => state.set(eventKey(event.id), event);

function summary({ id, name, capacity, attendees }: Event) {
  const registered = attendees.filter((a) => a.status === "registered").length;
  return { eventId: id, name, capacity, seatsLeft: Math.max(capacity - registered, 0) };
}

export const app = defineApp(manifest, {
  actions: {
    createEvent: async ({ name, capacity }, ctx) => {
      const event: Event = { id: crypto.randomUUID().slice(0, 8), name, capacity, attendees: [] };
      await saveEvent(ctx.state, event);
      await ctx.state.set(EVENTS, [...((await ctx.state.get<string[]>(EVENTS)) ?? []), event.id]);
      return { eventId: event.id };
    },

    listEvents: async (_input, ctx) => {
      const ids = (await ctx.state.get<string[]>(EVENTS)) ?? [];
      const events = await Promise.all(ids.map((id) => loadEvent(ctx.state, id)));
      return { events: events.map(summary) };
    },

    eventInfo: async ({ eventId }, ctx) => summary(await loadEvent(ctx.state, eventId)),

    register: async ({ eventId, email, firstName, lastName }, ctx) => {
      const event = await loadEvent(ctx.state, eventId);
      const key = normalize(email);
      const existing = event.attendees.find((a) => a.email === key);
      if (existing) return placement(event.attendees, existing);

      const person = {
        email: key,
        ...(firstName !== undefined && { firstName }),
        ...(lastName !== undefined && { lastName }),
      };
      // The registration stands even when the CRM is down or not bound.
      let crmContactId: string | null = null;
      try {
        crmContactId = (await ctx.ports.upsertContact(person)).contactId;
      } catch (error) {
        await ctx.log.warn("CRM sync failed", { email: key, error: error instanceof Error ? error.message : String(error) });
      }

      const attendee: Attendee = {
        ...person,
        status: summary(event).seatsLeft > 0 ? "registered" : "waitlisted",
        checkedIn: false,
        crmContactId,
      };
      const attendees = [...event.attendees, attendee];
      await saveEvent(ctx.state, { ...event, attendees });
      await ctx.log.info(`${attendee.status} for ${event.name}`, { email: key });
      return placement(attendees, attendee);
    },

    checkIn: async ({ eventId, email }, ctx) => {
      const event = await loadEvent(ctx.state, eventId);
      const key = normalize(email);
      if (event.attendees.find((a) => a.email === key)?.status !== "registered") return { checkedIn: false };

      await saveEvent(ctx.state, {
        ...event,
        attendees: event.attendees.map((a) => (a.email === key ? { ...a, checkedIn: true } : a)),
      });
      return { checkedIn: true };
    },

    listAttendees: async ({ eventId }, ctx) => {
      const { attendees } = await loadEvent(ctx.state, eventId);
      const view = ({ status: _status, ...rest }: Attendee) => rest;
      return {
        registered: attendees.filter((a) => a.status === "registered").map(view),
        waitlist: attendees.filter((a) => a.status === "waitlisted").map(view),
      };
    },
  },
});

function normalize(email: string): string {
  return email.trim().toLowerCase();
}

/** The attendee's status, with its 1-based position among attendees of the same status. */
function placement(attendees: Attendee[], attendee: Attendee) {
  const position = attendees.filter((a) => a.status === attendee.status).indexOf(attendee) + 1;
  return { status: attendee.status, position, crmContactId: attendee.crmContactId };
}
