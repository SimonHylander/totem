import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { EventNotFound, createEvents } from "./events.js";

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);

function memoryStore() {
  const values = new Map<string, unknown>();
  return {
    get: <T>(key: string) => Effect.sync(() => (values.get(key) ?? null) as T | null),
    set: (key: string, value: unknown) => Effect.sync(() => void values.set(key, value)),
    update: <T>(key: string, f: (current: T | null) => T) =>
      Effect.sync(() => {
        const next = f((values.get(key) ?? null) as T | null);
        values.set(key, next);
        return next;
      }),
  };
}

/** The Events module on an empty store, with a CRM that hands out sequential contact IDs. */
function setup(upsertContact = sequentialCrm()) {
  const crmCalls: unknown[] = [];
  const logs: unknown[] = [];
  const events = createEvents<never>({
    store: memoryStore(),
    upsertContact: (person) => {
      crmCalls.push(person);
      return Effect.tryPromise({ try: () => upsertContact(), catch: (error) => error });
    },
    log: {
      info: (message, data) => Effect.sync(() => void logs.push({ level: "info", message, data })),
      warn: (message, data) => Effect.sync(() => void logs.push({ level: "warn", message, data })),
    },
  });
  return { events, crmCalls, logs };
}

function sequentialCrm() {
  let next = 0;
  return async () => ({ contactId: `c${++next}` });
}

describe("events", () => {
  it("creates events and lists them with seats left", async () => {
    const { events } = setup();
    const launch = await run(events.createEvent({ name: "Totem launch", capacity: 2 }));
    const workshop = await run(events.createEvent({ name: "HubSpot workshop", capacity: 20 }));
    await run(events.register({ eventId: launch.eventId, email: "ada@acme.com" }));

    expect(await run(events.listEvents())).toEqual({
      events: [
        { eventId: launch.eventId, name: "Totem launch", capacity: 2, seatsLeft: 1 },
        { eventId: workshop.eventId, name: "HubSpot workshop", capacity: 20, seatsLeft: 20 },
      ],
    });
    expect(await run(events.eventInfo({ eventId: workshop.eventId }))).toEqual({
      eventId: workshop.eventId,
      name: "HubSpot workshop",
      capacity: 20,
      seatsLeft: 20,
    });
  });

  it("throws EventNotFound for an unknown event", async () => {
    const { events } = setup();
    await expect(run(events.eventInfo({ eventId: "nope" }))).rejects.toBeInstanceOf(EventNotFound);
    await expect(run(events.register({ eventId: "nope", email: "ada@acme.com" }))).rejects.toBeInstanceOf(EventNotFound);
    await expect(run(events.checkIn({ eventId: "nope", email: "ada@acme.com" }))).rejects.toBeInstanceOf(EventNotFound);
    await expect(run(events.listAttendees({ eventId: "nope" }))).rejects.toBeInstanceOf(EventNotFound);
  });
});

describe("register", () => {
  it("registers up to capacity, then waitlists, per event, syncing everyone to the CRM", async () => {
    const { events, crmCalls } = setup();
    const { eventId } = await run(events.createEvent({ name: "Totem launch", capacity: 2 }));
    const other = await run(events.createEvent({ name: "HubSpot workshop", capacity: 1 }));

    expect(await run(events.register({ eventId, email: "ada@acme.com" }))).toEqual({ status: "registered", position: 1, crmContactId: "c1" });
    expect(await run(events.register({ eventId, email: "bob@acme.com" }))).toEqual({ status: "registered", position: 2, crmContactId: "c2" });
    expect(await run(events.register({ eventId, email: "cy@acme.com" }))).toEqual({ status: "waitlisted", position: 1, crmContactId: "c3" });
    expect(await run(events.register({ eventId: other.eventId, email: "cy@acme.com" }))).toEqual({
      status: "registered",
      position: 1,
      crmContactId: "c4",
    });
    expect(crmCalls).toEqual([{ email: "ada@acme.com" }, { email: "bob@acme.com" }, { email: "cy@acme.com" }, { email: "cy@acme.com" }]);
  });

  it("returns the first result when the same email registers again", async () => {
    const { events, crmCalls } = setup();
    const { eventId } = await run(events.createEvent({ name: "Totem launch", capacity: 2 }));

    await run(events.register({ eventId, email: "ada@acme.com", firstName: "Ada" }));
    const again = await run(events.register({ eventId, email: " ADA@acme.com " }));

    expect(again).toEqual({ status: "registered", position: 1, crmContactId: "c1" });
    expect(crmCalls).toEqual([{ email: "ada@acme.com", firstName: "Ada" }]);
  });

  it("counts seats after the CRM call, so two concurrent registrations do not both get the last seat", async () => {
    const { events } = setup();
    const { eventId } = await run(events.createEvent({ name: "Totem launch", capacity: 1 }));

    const results = await Promise.all([
      run(events.register({ eventId, email: "ada@acme.com" })),
      run(events.register({ eventId, email: "bob@acme.com" })),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual(["registered", "waitlisted"]);
    const { registered, waitlist } = await run(events.listAttendees({ eventId }));
    expect([registered.length, waitlist.length]).toEqual([1, 1]);
  });

  it("logs each registration", async () => {
    const { events, logs } = setup();
    const { eventId } = await run(events.createEvent({ name: "Totem launch", capacity: 1 }));

    await run(events.register({ eventId, email: "ada@acme.com" }));
    await run(events.register({ eventId, email: "bob@acme.com" }));

    expect(logs).toEqual([
      { level: "info", message: "registered for Totem launch", data: { email: "ada@acme.com" } },
      { level: "info", message: "waitlisted for Totem launch", data: { email: "bob@acme.com" } },
    ]);
  });

  it("keeps the registration and warns when the CRM fails", async () => {
    const { events, logs } = setup(async () => {
      throw new Error("HubSpot returned 503");
    });
    const { eventId } = await run(events.createEvent({ name: "Totem launch", capacity: 2 }));

    expect(await run(events.register({ eventId, email: "ada@acme.com" }))).toEqual({ status: "registered", position: 1, crmContactId: null });
    expect(logs[0]).toEqual({ level: "warn", message: "CRM sync failed", data: { email: "ada@acme.com", error: "HubSpot returned 503" } });
  });
});

describe("checkIn and listAttendees", () => {
  it("checks in registered attendees only and lists both groups", async () => {
    const { events } = setup();
    const { eventId } = await run(events.createEvent({ name: "Totem launch", capacity: 2 }));
    for (const email of ["ada@acme.com", "bob@acme.com", "cy@acme.com"]) await run(events.register({ eventId, email }));

    expect(await run(events.checkIn({ eventId, email: "ADA@acme.com" }))).toEqual({ checkedIn: true });
    expect(await run(events.checkIn({ eventId, email: "cy@acme.com" }))).toEqual({ checkedIn: false });
    expect(await run(events.checkIn({ eventId, email: "nobody@acme.com" }))).toEqual({ checkedIn: false });

    expect(await run(events.listAttendees({ eventId }))).toEqual({
      registered: [
        { email: "ada@acme.com", checkedIn: true, crmContactId: "c1" },
        { email: "bob@acme.com", checkedIn: false, crmContactId: "c2" },
      ],
      waitlist: [{ email: "cy@acme.com", checkedIn: false, crmContactId: "c3" }],
    });
  });
});
