import { describe, expect, it } from "vitest";
import { AppError, fakePlatform } from "@totem/sdk";
import { EVENT_NOT_FOUND, app } from "./app.js";

// These tests cover how the actions map onto the platform. events/events.test.ts covers the rules.

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

describe("actions", () => {
  it("run every operation on install state and the CRM port", async () => {
    const { platform, createEvent, register } = setup();
    const { eventId } = await createEvent("Totem launch", 1);

    expect(await register(eventId, "ada@acme.com")).toEqual({ status: "registered", position: 1, crmContactId: "c1" });
    expect(platform.portCalls.map((c) => c.input)).toEqual([{ email: "ada@acme.com" }]);

    const summary = { eventId, name: "Totem launch", capacity: 1, seatsLeft: 0 };
    expect(await app.invoke("eventInfo", { eventId }, { platform })).toEqual(summary);
    expect(await app.invoke("listEvents", {}, { platform })).toEqual({ events: [summary] });
    expect(await app.invoke("checkIn", { eventId, email: "ada@acme.com" }, { platform })).toEqual({ checkedIn: true });
    expect(await app.invoke("listAttendees", { eventId }, { platform })).toEqual({
      registered: [{ email: "ada@acme.com", checkedIn: true, crmContactId: "c1" }],
      waitlist: [],
    });
  });

  it("answer EVENT_NOT_FOUND for an unknown event", async () => {
    const { platform, register } = setup();
    await expect(app.invoke("eventInfo", { eventId: "nope" }, { platform })).rejects.toMatchObject({ code: EVENT_NOT_FOUND });
    await expect(register("nope", "ada@acme.com")).rejects.toMatchObject({ code: EVENT_NOT_FOUND });
    // checkIn throws from inside state.update.
    await expect(app.invoke("checkIn", { eventId: "nope", email: "ada@acme.com" }, { platform })).rejects.toMatchObject({ code: EVENT_NOT_FOUND });
  });

  it("give the last seat once when state writes conflict", async () => {
    const { platform, createEvent, register } = setup();
    const { eventId } = await createEvent("Totem launch", 1);

    const results = await Promise.all([register(eventId, "ada@acme.com"), register(eventId, "bob@acme.com")]);

    expect(results.map((r) => r.status).sort()).toEqual(["registered", "waitlisted"]);
    const { registered, waitlist } = await app.invoke("listAttendees", { eventId }, { platform });
    expect([registered.length, waitlist.length]).toEqual([1, 1]);
  });

  it("log a CRM failure to the platform", async () => {
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
