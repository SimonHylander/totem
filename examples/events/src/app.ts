import { defineApp, type CallCtx } from "@totem/sdk";
import { manifest } from "./manifest.js";

// One install runs one event. All attendees live in install state under one key, in registration
// order. State has no compare-and-set, so two calls that land at the same moment read the same list
// and the second write wins: an attendee can be lost and the last seat can be given twice.

type Attendee = {
  email: string;
  firstName?: string;
  lastName?: string;
  status: "registered" | "waitlisted";
  checkedIn: boolean;
  crmContactId: string | null;
};

const ATTENDEES = "attendees";

type State = CallCtx<typeof manifest>["state"];

/** The attendee list, empty for a new event. */
async function loadAttendees(state: State): Promise<Attendee[]> {
  return (await state.get<Attendee[]>(ATTENDEES)) ?? [];
}

export const app = defineApp(manifest, {
  actions: {
    register: async ({ email, firstName, lastName }, ctx) => {
      const attendees = await loadAttendees(ctx.state);
      const key = normalize(email);
      const existing = attendees.find((a) => a.email === key);
      if (existing) return placement(attendees, existing);

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

      const registered = attendees.filter((a) => a.status === "registered").length;
      const attendee: Attendee = {
        ...person,
        status: registered < ctx.config.capacity ? "registered" : "waitlisted",
        checkedIn: false,
        crmContactId,
      };
      const updated = [...attendees, attendee];
      await ctx.state.set(ATTENDEES, updated);
      await ctx.log.info(`${attendee.status} for ${ctx.config.eventName}`, { email: key });
      return placement(updated, attendee);
    },

    checkIn: async ({ email }, ctx) => {
      const attendees = await loadAttendees(ctx.state);
      const key = normalize(email);
      if (attendees.find((a) => a.email === key)?.status !== "registered") return { checkedIn: false };

      await ctx.state.set(
        ATTENDEES,
        attendees.map((a) => (a.email === key ? { ...a, checkedIn: true } : a)),
      );
      return { checkedIn: true };
    },

    eventInfo: async (_input, ctx) => {
      const registered = (await loadAttendees(ctx.state)).filter((a) => a.status === "registered").length;
      const { eventName, capacity } = ctx.config;
      return { eventName, capacity, seatsLeft: Math.max(capacity - registered, 0) };
    },

    listAttendees: async (_input, ctx) => {
      const attendees = await loadAttendees(ctx.state);
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
