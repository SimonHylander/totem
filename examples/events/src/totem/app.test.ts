import { describe, expect, it } from "vitest";
import { AppError, fakePlatform } from "@totem/sdk";
import { EVENT_NOT_FOUND, app } from "./app.js";

/** A platform whose CRM port hands out sequential contact IDs, plus helpers bound to it. */
function setup(upsertContact = sequentialCrm()) {
  const platform = fakePlatform(app, { ports: { upsertContact } });
  const createEvent = (name: string, capacity: number) => app.invoke("createEvent", { name, capacity }, { platform });
  const register = (eventId: string, email: string) => app.invoke("register", { eventId, email }, { platform });
  return { platform, createEvent, register };
}

function sequentialCrm() {
  let next = 0;
  return async () => ({ contactId: `c${++next}`, created: true });
}

describe("events", () => {
  it("creates events and lists them with seats left", async () => {
    const { platform, createEvent, register } = setup();
    const launch = await createEvent("Totem launch", 2);
    const workshop = await createEvent("HubSpot workshop", 20);
    await register(launch.eventId, "ada@acme.com");

    expect(await app.invoke("listEvents", {}, { platform })).toEqual({
      events: [
        { eventId: launch.eventId, name: "Totem launch", capacity: 2, seatsLeft: 1 },
        { eventId: workshop.eventId, name: "HubSpot workshop", capacity: 20, seatsLeft: 20 },
      ],
    });
    expect(await app.invoke("eventInfo", { eventId: workshop.eventId }, { platform })).toEqual({
      eventId: workshop.eventId,
      name: "HubSpot workshop",
      capacity: 20,
      seatsLeft: 20,
    });
  });

  it("answers EVENT_NOT_FOUND for an unknown event", async () => {
    const { platform, register } = setup();
    await expect(app.invoke("eventInfo", { eventId: "nope" }, { platform })).rejects.toMatchObject({ code: EVENT_NOT_FOUND });
    await expect(register("nope", "ada@acme.com")).rejects.toMatchObject({ code: EVENT_NOT_FOUND });
  });
});

describe("register", () => {
  it("registers up to capacity, then waitlists, per event, syncing everyone to the CRM", async () => {
    const { platform, createEvent, register } = setup();
    const { eventId } = await createEvent("Totem launch", 2);
    const other = await createEvent("HubSpot workshop", 1);

    expect(await register(eventId, "ada@acme.com")).toEqual({ status: "registered", position: 1, crmContactId: "c1" });
    expect(await register(eventId, "bob@acme.com")).toEqual({ status: "registered", position: 2, crmContactId: "c2" });
    expect(await register(eventId, "cy@acme.com")).toEqual({ status: "waitlisted", position: 1, crmContactId: "c3" });
    expect(await register(other.eventId, "cy@acme.com")).toEqual({ status: "registered", position: 1, crmContactId: "c4" });
    expect(platform.portCalls.map((c) => c.input)).toEqual([
      { email: "ada@acme.com" },
      { email: "bob@acme.com" },
      { email: "cy@acme.com" },
      { email: "cy@acme.com" },
    ]);
  });

  it("returns the first result when the same email registers again", async () => {
    const { platform, createEvent } = setup();
    const { eventId } = await createEvent("Totem launch", 2);

    await app.invoke("register", { eventId, email: "ada@acme.com", firstName: "Ada" }, { platform });
    const again = await app.invoke("register", { eventId, email: " ADA@acme.com " }, { platform });

    expect(again).toEqual({ status: "registered", position: 1, crmContactId: "c1" });
    expect(platform.portCalls).toHaveLength(1);
  });

  it("keeps the registration when the CRM fails", async () => {
    const { platform, createEvent, register } = setup(async () => {
      throw new AppError(1001, "HubSpot returned 503");
    });
    const { eventId } = await createEvent("Totem launch", 2);

    expect(await register(eventId, "ada@acme.com")).toEqual({ status: "registered", position: 1, crmContactId: null });
    expect(platform.logs[0]).toEqual({
      level: "warn",
      message: "CRM sync failed",
      data: { email: "ada@acme.com", error: "HubSpot returned 503" },
    });
  });
});

describe("checkIn and listAttendees", () => {
  it("checks in registered attendees only and lists both groups", async () => {
    const { platform, createEvent, register } = setup();
    const { eventId } = await createEvent("Totem launch", 2);
    for (const email of ["ada@acme.com", "bob@acme.com", "cy@acme.com"]) await register(eventId, email);
    const checkIn = (email: string) => app.invoke("checkIn", { eventId, email }, { platform });

    expect(await checkIn("ADA@acme.com")).toEqual({ checkedIn: true });
    expect(await checkIn("cy@acme.com")).toEqual({ checkedIn: false });
    expect(await checkIn("nobody@acme.com")).toEqual({ checkedIn: false });

    expect(await app.invoke("listAttendees", { eventId }, { platform })).toEqual({
      registered: [
        { email: "ada@acme.com", checkedIn: true, crmContactId: "c1" },
        { email: "bob@acme.com", checkedIn: false, crmContactId: "c2" },
      ],
      waitlist: [{ email: "cy@acme.com", checkedIn: false, crmContactId: "c3" }],
    });
  });
});
