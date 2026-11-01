import { AppError, defineApp, type CallCtx } from "@totem/sdk";
import { manifest } from "./manifest.js";

// One install serves one tenant, and the tenant runs many events through it. Each event lives in
// install state under `event:<id>`, and `events` lists the IDs oldest first. Every change to a stored
// value goes through `state.update`, so calls that land at the same moment do not lose each other's
// writes or give the last seat twice.

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

/** Store `f(event)` for a stored event and return it. `f` can run more than once, as `state.update` retries. */
function updateEvent(state: State, id: string, f: (event: Event) => Event): Promise<Event> {
  return state.update<Event>(eventKey(id), (event) => {
    if (!event) throw new AppError(EVENT_NOT_FOUND, `no event ${id}`);
    return f(event);
  });
}

function summary({ id, name, capacity, attendees }: Event) {
  const registered = attendees.filter((a) => a.status === "registered").length;
  return { eventId: id, name, capacity, seatsLeft: Math.max(capacity - registered, 0) };
}

export const app = defineApp(manifest, {
  actions: {
    createEvent: async ({ name, capacity }, ctx) => {
      const event: Event = { id: crypto.randomUUID().slice(0, 8), name, capacity, attendees: [] };
      await ctx.state.set(eventKey(event.id), event);
      await ctx.state.update<string[]>(EVENTS, (ids) => [...(ids ?? []), event.id]);
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

      // Seats are counted on the event as stored now, which may have changed during the CRM call.
      const saved = await updateEvent(ctx.state, eventId, (current) =>
        current.attendees.some((a) => a.email === key)
          ? current
          : {
              ...current,
              attendees: [
                ...current.attendees,
                { ...person, status: summary(current).seatsLeft > 0 ? "registered" : "waitlisted", checkedIn: false, crmContactId },
              ],
            },
      );
      // The update above always leaves this attendee on the event.
      const attendee = saved.attendees.find((a) => a.email === key)!;
      await ctx.log.info(`${attendee.status} for ${saved.name}`, { email: key });
      return placement(saved.attendees, attendee);
    },

    checkIn: async ({ eventId, email }, ctx) => {
      const key = normalize(email);
      const saved = await updateEvent(ctx.state, eventId, (event) => ({
        ...event,
        attendees: event.attendees.map((a) => (a.email === key && a.status === "registered" ? { ...a, checkedIn: true } : a)),
      }));
      return { checkedIn: saved.attendees.some((a) => a.email === key && a.checkedIn) };
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
