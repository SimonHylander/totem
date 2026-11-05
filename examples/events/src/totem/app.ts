import { AppError, Totem, type RpcError } from "@totem/sdk";
import { Effect } from "effect";
import { EventNotFound, createEvents } from "../events/events.js";
import { manifest } from "./manifest.js";

export const EVENT_NOT_FOUND = 2001;

type Events = ReturnType<typeof createEvents<RpcError>>;

const withEvents = <A>(ctx: Totem.Context<typeof manifest>, operation: (events: Events) => Effect.Effect<A, EventNotFound | RpcError>) =>
  operation(createEvents({ store: ctx.state, upsertContact: ctx.ports.upsertContact, log: ctx.log })).pipe(
    Effect.mapError((error) => (error instanceof EventNotFound ? new AppError(EVENT_NOT_FOUND, error.message) : error)),
  );

export const app = Totem.App(
  { manifest },
  Effect.succeed({
    actions: {
      createEvent: (input, ctx) => withEvents(ctx, (events) => events.createEvent(input)),
      listEvents: (_input, ctx) => withEvents(ctx, (events) => events.listEvents()),
      eventInfo: (input, ctx) => withEvents(ctx, (events) => events.eventInfo(input)),
      register: (input, ctx) => withEvents(ctx, (events) => events.register(input)),
      checkIn: (input, ctx) => withEvents(ctx, (events) => events.checkIn(input)),
      listAttendees: (input, ctx) => withEvents(ctx, (events) => events.listAttendees(input)),
    },
  }),
);
