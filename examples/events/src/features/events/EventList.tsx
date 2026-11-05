import { Link, getRouteApi } from "@tanstack/react-router";

const route = getRouteApi("/");

export function EventList() {
  const { events } = route.useLoaderData();
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
    </main>
  );
}

export function EventListError() {
  return (
    <main>
      <h1 className="title">Events</h1>
      <p className="notice">Events could not be loaded. Reload the page to try again.</p>
    </main>
  );
}
