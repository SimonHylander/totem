import { AppError, defineApp, type CallCtx } from "@totem/sdk";
import { EventNotFound, createEvents } from "../events/events.js";
import { manifest } from "./manifest.js";

// One install serves one tenant, and the tenant runs many events through it. Each action runs the
// Events module on the install's state, its CRM port, and its log.

/** The `AppError` code from `eventInfo`, `register`, `checkIn`, and `listAttendees` for an event ID the install does not have. */
export const EVENT_NOT_FOUND = 2001;

type Events = ReturnType<typeof createEvents>;

/** Runs `operation` on the install's Events module and turns `EventNotFound` into an `AppError`. */
async function withEvents<T>(ctx: CallCtx<typeof manifest>, operation: (events: Events) => Promise<T>): Promise<T> {
  const events = createEvents({ store: ctx.state, upsertContact: ctx.ports.upsertContact, log: ctx.log });
  try {
    return await operation(events);
  } catch (error) {
    if (error instanceof EventNotFound) throw new AppError(EVENT_NOT_FOUND, error.message);
    throw error;
  }
}

export const app = defineApp(manifest, {
  actions: {
    createEvent: (input, ctx) => withEvents(ctx, (events) => events.createEvent(input)),
    listEvents: (_input, ctx) => withEvents(ctx, (events) => events.listEvents()),
    eventInfo: (input, ctx) => withEvents(ctx, (events) => events.eventInfo(input)),
    register: (input, ctx) => withEvents(ctx, (events) => events.register(input)),
    checkIn: (input, ctx) => withEvents(ctx, (events) => events.checkIn(input)),
    listAttendees: (input, ctx) => withEvents(ctx, (events) => events.listAttendees(input)),
  },
});
