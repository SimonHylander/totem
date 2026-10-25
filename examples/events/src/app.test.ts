import { describe, expect, it } from "vitest";
import { AppError, fakePlatform } from "@totem/sdk";
import { app } from "./app.js";

const context = { config: { eventName: "Totem launch", capacity: 2 } };

/** A platform whose CRM port hands out sequential contact IDs. */
function withCrm() {
  let next = 0;
  return fakePlatform(app, {
    ports: { upsertContact: async () => ({ contactId: `c${++next}`, created: true }) },
  });
}

describe("register", () => {
  it("registers up to capacity, then waitlists, syncing everyone to the CRM", async () => {
    const platform = withCrm();
    const register = (email: string) => app.invoke("register", { email }, { platform, context });

    expect(await register("ada@acme.com")).toEqual({ status: "registered", position: 1, crmContactId: "c1" });
    expect(await register("bob@acme.com")).toEqual({ status: "registered", position: 2, crmContactId: "c2" });
    expect(await register("cy@acme.com")).toEqual({ status: "waitlisted", position: 1, crmContactId: "c3" });
    expect(platform.portCalls).toEqual([
      { port: "upsertContact", input: { email: "ada@acme.com" } },
      { port: "upsertContact", input: { email: "bob@acme.com" } },
      { port: "upsertContact", input: { email: "cy@acme.com" } },
    ]);
  });

  it("returns the first result when the same email registers again", async () => {
    const platform = withCrm();

    await app.invoke("register", { email: "ada@acme.com", firstName: "Ada" }, { platform, context });
    const again = await app.invoke("register", { email: " ADA@acme.com " }, { platform, context });

    expect(again).toEqual({ status: "registered", position: 1, crmContactId: "c1" });
    expect(platform.portCalls).toHaveLength(1);
  });

  it("keeps the registration when the CRM fails", async () => {
    const platform = fakePlatform(app, {
      ports: {
        upsertContact: async () => {
          throw new AppError(1001, "HubSpot returned 503");
        },
      },
    });

    const result = await app.invoke("register", { email: "ada@acme.com" }, { platform, context });

    expect(result).toEqual({ status: "registered", position: 1, crmContactId: null });
    expect(platform.logs[0]).toEqual({
      level: "warn",
      message: "CRM sync failed",
      data: { email: "ada@acme.com", error: "HubSpot returned 503" },
    });
  });
});

describe("eventInfo", () => {
  it("counts seats left, never below zero", async () => {
    const platform = withCrm();
    expect(await app.invoke("eventInfo", {}, { platform, context })).toEqual({ eventName: "Totem launch", capacity: 2, seatsLeft: 2 });

    for (const email of ["ada@acme.com", "bob@acme.com", "cy@acme.com"]) {
      await app.invoke("register", { email }, { platform, context });
    }
    expect(await app.invoke("eventInfo", {}, { platform, context })).toMatchObject({ seatsLeft: 0 });
  });
});

describe("checkIn and listAttendees", () => {
  it("checks in registered attendees only and lists both groups", async () => {
    const platform = withCrm();
    for (const email of ["ada@acme.com", "bob@acme.com", "cy@acme.com"]) {
      await app.invoke("register", { email }, { platform, context });
    }

    expect(await app.invoke("checkIn", { email: "ADA@acme.com" }, { platform, context })).toEqual({ checkedIn: true });
    expect(await app.invoke("checkIn", { email: "cy@acme.com" }, { platform, context })).toEqual({ checkedIn: false });
    expect(await app.invoke("checkIn", { email: "nobody@acme.com" }, { platform, context })).toEqual({ checkedIn: false });

    expect(await app.invoke("listAttendees", {}, { platform, context })).toEqual({
      registered: [
        { email: "ada@acme.com", checkedIn: true, crmContactId: "c1" },
        { email: "bob@acme.com", checkedIn: false, crmContactId: "c2" },
      ],
      waitlist: [{ email: "cy@acme.com", checkedIn: false, crmContactId: "c3" }],
    });
  });
});
