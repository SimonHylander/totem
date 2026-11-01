import { createFileRoute } from "@tanstack/react-router";
import { EventList, EventListError } from "../features/events/EventList.js";
import { listEvents } from "../features/events/server.js";

export const Route = createFileRoute("/")({
  loader: () => listEvents(),
  errorComponent: EventListError,
  component: EventList,
});
