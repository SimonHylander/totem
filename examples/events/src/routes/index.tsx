import { Link, createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { eventsInstall, totem } from "../totem.js";

// Every event of the tenant install this deployment serves.

const listEvents = createServerFn({ method: "GET" }).handler(() => totem().client.start(eventsInstall(), "listEvents", {}));

export const Route = createFileRoute("/")({
  loader: () => listEvents(),
  errorComponent: () => (
    <main>
      <h1 className="title">Events</h1>
      <p className="notice">Events could not be loaded. Reload the page to try again.</p>
    </main>
  ),
  component: EventList,
});

function EventList() {
  const { events } = Route.useLoaderData();
  return (
    <main>
      <h1 className="title">Events</h1>
      {events.length === 0 ? (
        <p className="notice">No events yet.</p>
      ) : (
        <ul className="events">
          {events.map((event) => (
            <li key={event.eventId} className="event">
              <Link to="/events/$eventId" params={{ eventId: event.eventId }}>
                <span className="event-name">{event.name}</span>
                <span className="event-count">
                  {event.seatsLeft > 0 ? (
                    <>
                      <b>{event.seatsLeft}</b> of {event.capacity} open
                    </>
                  ) : (
                    <>
                      <b>Full</b> · waitlist open
                    </>
                  )}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <p className="admin">
        <Link to="/integrations">Manage integrations</Link>
      </p>
    </main>
  );
}
