import { Link, createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { eventsInstall, totem } from "../totem.js";

// Every event of the tenant install this deployment serves.

const listEvents = createServerFn({ method: "GET" }).handler(() => totem().client.start(eventsInstall(), "listEvents", {}));

export const Route = createFileRoute("/")({
  loader: () => listEvents(),
  errorComponent: () => <p>Events could not be loaded.</p>,
  component: EventList,
});

function EventList() {
  const { events } = Route.useLoaderData();
  return (
    <main>
      <h1>Events</h1>
      <p>
        <Link to="/integrations">Integrations</Link>
      </p>
      {events.length === 0 && <p>No events yet.</p>}
      <ul>
        {events.map((event) => (
          <li key={event.eventId}>
            <Link to="/events/$eventId" params={{ eventId: event.eventId }}>
              {event.name}
            </Link>{" "}
            · {event.seatsLeft > 0 ? `${event.seatsLeft} of ${event.capacity} seats left` : "full, waitlist open"}
          </li>
        ))}
      </ul>
    </main>
  );
}
