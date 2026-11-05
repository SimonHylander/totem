import { Effect, Schema } from "effect";

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

type Log<E> = (message: string, data?: Record<string, unknown>) => Effect.Effect<void, E>;

/** `E` is how the caller's storage and logging fail. A CRM failure never fails an operation. */
type Dependencies<E> = {
  store: {
    get<T>(key: string): Effect.Effect<T | null, E>;
    set(key: string, value: unknown): Effect.Effect<void, E>;
    /** Store `f(current)` and return it, atomically per key. `f` can run more than once. */
    update<T>(key: string, f: (current: T | null) => T): Effect.Effect<T, E>;
  };
  upsertContact: (person: Person) => Effect.Effect<{ contactId: string }, unknown>;
  log: { info: Log<E>; warn: Log<E> };
};

/** An event ID the store does not have. */
export class EventNotFound extends Schema.TaggedError<EventNotFound>()("EventNotFound", { id: Schema.String }) {
  override get message() {
    return `no event ${this.id}`;
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
export function createEvents<E>({ store, upsertContact, log }: Dependencies<E>) {
  const loadEvent = Effect.fnUntraced(function* (id: string) {
    const event = yield* store.get<Event>(eventKey(id));
    if (!event) return yield* new EventNotFound({ id });
    return event;
  });

  /** Store `f(event)` for a stored event and return it. `store.update` can retry, so `f` can run more than once. */
  const updateEvent = Effect.fnUntraced(function* (id: string, f: (event: Event) => Event) {
    const saved = yield* store.update<Event | null>(eventKey(id), (event) => event && f(event));
    if (!saved) return yield* new EventNotFound({ id });
    return saved;
  });

  return {
    createEvent: Effect.fnUntraced(function* ({ name, capacity }: { readonly name: string; readonly capacity: number }) {
      const event: Event = { id: crypto.randomUUID().slice(0, 8), name, capacity, attendees: [] };
      yield* store.set(eventKey(event.id), event);
      yield* store.update<string[]>(EVENTS, (ids) => [...(ids ?? []), event.id]);
      return { eventId: event.id };
    }),

    listEvents: Effect.fnUntraced(function* () {
      const ids = (yield* store.get<string[]>(EVENTS)) ?? [];
      const events = yield* Effect.forEach(ids, loadEvent, { concurrency: "unbounded" });
      return { events: events.map(summary) };
    }),

    eventInfo: ({ eventId }: { readonly eventId: string }) => loadEvent(eventId).pipe(Effect.map(summary)),

    register: Effect.fnUntraced(function* ({ eventId, email, firstName, lastName }: Readonly<Person> & { readonly eventId: string }) {
      const event = yield* loadEvent(eventId);
      const key = normalize(email);
      const existing = event.attendees.find((a) => a.email === key);
      if (existing) return placement(event.attendees, existing);

      const person = {
        email: key,
        ...(firstName !== undefined && { firstName }),
        ...(lastName !== undefined && { lastName }),
      };
      // The registration succeeds even when the CRM call fails or no CRM is bound.
      const crmContactId = yield* upsertContact(person).pipe(
        Effect.map(({ contactId }): string | null => contactId),
        Effect.catch((error) =>
          log.warn("CRM sync failed", { email: key, error: error instanceof Error ? error.message : String(error) }).pipe(Effect.as(null)),
        ),
      );

      // Count seats on the event as stored now, because it can change during the CRM call.
      const saved = yield* updateEvent(eventId, (current) =>
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
      yield* log.info(`${attendee.status} for ${saved.name}`, { email: key });
      return placement(saved.attendees, attendee);
    }),

    checkIn: Effect.fnUntraced(function* ({ eventId, email }: { readonly eventId: string; readonly email: string }) {
      const key = normalize(email);
      const saved = yield* updateEvent(eventId, (event) => ({
        ...event,
        attendees: event.attendees.map((a) => (a.email === key && a.status === "registered" ? { ...a, checkedIn: true } : a)),
      }));
      return { checkedIn: saved.attendees.some((a) => a.email === key && a.checkedIn) };
    }),

    listAttendees: Effect.fnUntraced(function* ({ eventId }: { readonly eventId: string }) {
      const { attendees } = yield* loadEvent(eventId);
      const view = ({ status: _status, ...rest }: Attendee) => rest;
      return {
        registered: attendees.filter((a) => a.status === "registered").map(view),
        waitlist: attendees.filter((a) => a.status === "waitlisted").map(view),
      };
    }),
  };
}
