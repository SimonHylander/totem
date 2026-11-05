// The rules for running events: capacity, the waitlist, registering twice, check-in, and what happens
// when the CRM fails. This module does not depend on Totem. Its caller supplies storage, the CRM, and
// logging.
//
// Each event is stored under `event:<id>`, and `events` lists the IDs oldest first. Every change to an
// existing value goes through `store.update`, so concurrent calls do not lose each other's writes or
// give the last seat twice.

type Person = { email: string; firstName?: string; lastName?: string };

type Attendee = Person & {
  status: "registered" | "waitlisted";
  checkedIn: boolean;
  crmContactId: string | null;
};

type Event = { id: string; name: string; capacity: number; attendees: Attendee[] };

type Log = (message: string, data?: Record<string, unknown>) => Promise<void>;

type Dependencies = {
  store: {
    get<T>(key: string): Promise<T | null>;
    set(key: string, value: unknown): Promise<void>;
    /** Store `f(current)` and return it, atomically per key. `f` can run more than once. */
    update<T>(key: string, f: (current: T | null) => T): Promise<T>;
  };
  upsertContact: (person: Person) => Promise<{ contactId: string }>;
  log: { info: Log; warn: Log };
};

/** Thrown for an event ID the store does not have. */
export class EventNotFound extends Error {
  constructor(id: string) {
    super(`no event ${id}`);
  }
}

const EVENTS = "events";
const eventKey = (id: string) => `event:${id}`;

function summary({ id, name, capacity, attendees }: Event) {
  const registered = attendees.filter((a) => a.status === "registered").length;
  return { eventId: id, name, capacity, seatsLeft: Math.max(capacity - registered, 0) };
}

function normalize(email: string): string {
  return email.trim().toLowerCase();
}

/** The attendee's status, 1-based position among attendees of that status, and CRM contact ID. */
function placement(attendees: Attendee[], attendee: Attendee) {
  const position = attendees.filter((a) => a.status === attendee.status).indexOf(attendee) + 1;
  return { status: attendee.status, position, crmContactId: attendee.crmContactId };
}

/** The operations on one tenant's events. Each one reads and writes through `store`. */
export function createEvents({ store, upsertContact, log }: Dependencies) {
  async function loadEvent(id: string): Promise<Event> {
    const event = await store.get<Event>(eventKey(id));
    if (!event) throw new EventNotFound(id);
    return event;
  }

  /** Store `f(event)` for a stored event and return it. `store.update` can retry, so `f` can run more than once. */
  function updateEvent(id: string, f: (event: Event) => Event): Promise<Event> {
    return store.update<Event>(eventKey(id), (event) => {
      if (!event) throw new EventNotFound(id);
      return f(event);
    });
  }

  return {
    async createEvent({ name, capacity }: { name: string; capacity: number }) {
      const event: Event = { id: crypto.randomUUID().slice(0, 8), name, capacity, attendees: [] };
      await store.set(eventKey(event.id), event);
      await store.update<string[]>(EVENTS, (ids) => [...(ids ?? []), event.id]);
      return { eventId: event.id };
    },

    async listEvents() {
      const ids = (await store.get<string[]>(EVENTS)) ?? [];
      const events = await Promise.all(ids.map(loadEvent));
      return { events: events.map(summary) };
    },

    async eventInfo({ eventId }: { eventId: string }) {
      return summary(await loadEvent(eventId));
    },

    async register({ eventId, email, firstName, lastName }: Person & { eventId: string }) {
      const event = await loadEvent(eventId);
      const key = normalize(email);
      const existing = event.attendees.find((a) => a.email === key);
      if (existing) return placement(event.attendees, existing);

      const person = {
        email: key,
        ...(firstName !== undefined && { firstName }),
        ...(lastName !== undefined && { lastName }),
      };
      // The registration succeeds even when the CRM call fails or no CRM is bound.
      let crmContactId: string | null = null;
      try {
        crmContactId = (await upsertContact(person)).contactId;
      } catch (error) {
        await log.warn("CRM sync failed", { email: key, error: error instanceof Error ? error.message : String(error) });
      }

      // Count seats on the event as stored now, because it can change during the CRM call.
      const saved = await updateEvent(eventId, (current) =>
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
      await log.info(`${attendee.status} for ${saved.name}`, { email: key });
      return placement(saved.attendees, attendee);
    },

    async checkIn({ eventId, email }: { eventId: string; email: string }) {
      const key = normalize(email);
      const saved = await updateEvent(eventId, (event) => ({
        ...event,
        attendees: event.attendees.map((a) => (a.email === key && a.status === "registered" ? { ...a, checkedIn: true } : a)),
      }));
      return { checkedIn: saved.attendees.some((a) => a.email === key && a.checkedIn) };
    },

    async listAttendees({ eventId }: { eventId: string }) {
      const { attendees } = await loadEvent(eventId);
      const view = ({ status: _status, ...rest }: Attendee) => rest;
      return {
        registered: attendees.filter((a) => a.status === "registered").map(view),
        waitlist: attendees.filter((a) => a.status === "waitlisted").map(view),
      };
    },
  };
}
