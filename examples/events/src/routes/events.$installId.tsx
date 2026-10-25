import { useState, type FormEvent } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { totem } from "../totem.js";

// The public registration page for one event. Anyone with the URL can register (ADR 0014: the app
// decides who may trigger its actions). Each submit runs the app's `register` action through the
// platform, which syncs the attendee to the bound CRM.

type Registration = { installId: string; email: string; firstName?: string; lastName?: string };

/** Server functions are public endpoints, so check their input before it reaches the platform. */
function text(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${field} is required`);
  return value.trim();
}

function registration(data: unknown): Registration {
  const { installId, email, firstName, lastName } = (data ?? {}) as Record<string, unknown>;
  const optional = (value: unknown, field: string) => (value === undefined || value === "" ? undefined : text(value, field));
  const first = optional(firstName, "firstName");
  const last = optional(lastName, "lastName");
  return {
    installId: text(installId, "installId"),
    email: text(email, "email"),
    ...(first !== undefined && { firstName: first }),
    ...(last !== undefined && { lastName: last }),
  };
}

const getEvent = createServerFn({ method: "GET" })
  .validator((installId: unknown) => text(installId, "installId"))
  .handler(({ data: installId }) => totem().client.start(installId, "eventInfo", {}));

const registerAttendee = createServerFn({ method: "POST" })
  .validator(registration)
  .handler(({ data: { installId, ...person } }) => totem().client.start(installId, "register", person));

export const Route = createFileRoute("/events/$installId")({
  loader: ({ params }) => getEvent({ data: params.installId }),
  // Covers an unknown event and a platform that cannot be reached alike. The server log has the cause.
  errorComponent: () => <p>This event could not be loaded.</p>,
  component: EventPage,
});

type Result = Awaited<ReturnType<typeof registerAttendee>>;

function EventPage() {
  const event = Route.useLoaderData();
  const { installId } = Route.useParams();
  const [result, setResult] = useState<Result | null>(null);
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState(false);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = Object.fromEntries(new FormData(e.currentTarget));
    setPending(true);
    setFailed(false);
    try {
      setResult(await registerAttendee({ data: registration({ ...form, installId }) }));
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  };

  if (result) {
    return (
      <main>
        <h1>{event.eventName}</h1>
        <p>
          {result.status === "registered"
            ? `You're registered. You have seat ${result.position}.`
            : `The event is full. You're number ${result.position} on the waitlist.`}
        </p>
      </main>
    );
  }

  return (
    <main>
      <h1>{event.eventName}</h1>
      <p>{event.seatsLeft > 0 ? `${event.seatsLeft} of ${event.capacity} seats left.` : "Full. New registrations join the waitlist."}</p>
      <form onSubmit={submit} style={{ display: "grid", gap: 12 }}>
        <label>
          Email <input name="email" type="email" required />
        </label>
        <label>
          First name <input name="firstName" />
        </label>
        <label>
          Last name <input name="lastName" />
        </label>
        <button disabled={pending}>{pending ? "Registering…" : "Register"}</button>
        {failed && <p role="alert">Registration failed. Please try again.</p>}
      </form>
    </main>
  );
}
