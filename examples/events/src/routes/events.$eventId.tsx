import { useState, type FormEvent } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { nextSpot, sheetRows, type Row, type Spot } from "../sheet.js";
import { eventsInstall, totem } from "../totem.js";

// The public registration page for one event. Anyone with the URL can register (ADR 0014: the app
// decides who may trigger its actions). Each submit runs the app's `register` action through the
// platform, which syncs the attendee to the bound CRM. The page draws the event as a sign-up
// sheet (sheet.ts): the attendee's line previews what they type in the form below it, and their
// name is written onto it once they hold the spot.

type Registration = { eventId: string; email: string; firstName?: string; lastName?: string };

/** Server functions are public endpoints, so check their input before it reaches the platform. */
function text(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${field} is required`);
  return value.trim();
}

function registration(data: unknown): Registration {
  const { eventId, email, firstName, lastName } = (data ?? {}) as Record<string, unknown>;
  const optional = (value: unknown, field: string) => (value === undefined || value === "" ? undefined : text(value, field));
  const first = optional(firstName, "firstName");
  const last = optional(lastName, "lastName");
  return {
    eventId: text(eventId, "eventId"),
    email: text(email, "email"),
    ...(first !== undefined && { firstName: first }),
    ...(last !== undefined && { lastName: last }),
  };
}

const getEvent = createServerFn({ method: "GET" })
  .validator((eventId: unknown) => text(eventId, "eventId"))
  .handler(({ data: eventId }) => totem().client.start(eventsInstall(), "eventInfo", { eventId }));

const registerAttendee = createServerFn({ method: "POST" })
  .validator(registration)
  .handler(({ data }) => totem().client.start(eventsInstall(), "register", data));

export const Route = createFileRoute("/events/$eventId")({
  loader: ({ params }) => getEvent({ data: params.eventId }),
  head: ({ loaderData }) => ({ meta: [{ title: loaderData ? loaderData.name : "Event" }] }),
  // Covers an unknown event and a platform that cannot be reached alike. The server log has the cause.
  errorComponent: () => (
    <main>
      <h1 className="title">Event not found</h1>
      <p className="notice">This event could not be loaded. Check the link, or reload the page to try again.</p>
    </main>
  ),
  component: EventPage,
});

type Result = Awaited<ReturnType<typeof registerAttendee>>;

/** The text written on the attendee's line: their name when they give one, otherwise their email. */
function lineText({ email, firstName, lastName }: { email?: string; firstName?: string; lastName?: string }): string {
  return [firstName, lastName].map((part) => part?.trim()).filter(Boolean).join(" ") || (email?.trim() ?? "");
}

/** Mirrors the form into the attendee's line as they type. */
function draftOf(form: HTMLFormElement): string {
  const data = new FormData(form);
  const value = (name: string) => {
    const entry = data.get(name);
    return typeof entry === "string" ? entry : undefined;
  };
  return lineText({ email: value("email"), firstName: value("firstName"), lastName: value("lastName") });
}

/** What the attendee wrote on their line, shown once they hold it. */
type Signed = { result: Result; name: string };

function EventPage() {
  const event = Route.useLoaderData();
  const { eventId } = Route.useParams();
  const [signed, setSigned] = useState<Signed | null>(null);
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState(false);
  const [draft, setDraft] = useState("");

  const taken = event.capacity - event.seatsLeft;
  const spot: Spot = signed
    ? { list: signed.result.status === "registered" ? "seats" : "waitlist", position: signed.result.position }
    : nextSpot(event.capacity, event.seatsLeft);
  // Once registered, the attendee's own seat counts as taken, even when it is a seat they held before.
  const rows = sheetRows(event.capacity, signed && spot.list === "seats" ? Math.max(taken + 1, spot.position ?? 0) : taken, spot);
  const full = event.seatsLeft === 0;

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = Object.fromEntries(new FormData(e.currentTarget));
    const data = registration({ ...form, eventId });
    setPending(true);
    setFailed(false);
    try {
      const result = await registerAttendee({ data });
      setSigned({ result, name: lineText(data) });
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  };

  return (
    <main>
      <h1 className="title">{event.name}</h1>
      <p className="lede">
        {full ? `Full. All ${event.capacity} seats are taken, and the waitlist is open.` : `${event.seatsLeft} of ${event.capacity} seats open.`}
      </p>

      <form onSubmit={submit} onChange={(e) => setDraft(draftOf(e.currentTarget))} aria-describedby={failed ? "register-error" : undefined}>
        <ol className="sheet" aria-label={`Sign-up sheet for ${event.name}`}>
          {rows.map((row) => (
            <SheetRow key={rowKey(row)} row={row} signed={signed} draft={draft} />
          ))}
        </ol>

        {signed ? (
          <div className="result" role="status">
            <p className="result-line">
              {signed.result.status === "registered"
                ? `You're registered. Seat ${signed.result.position} is yours.`
                : `The event is full. You're number ${signed.result.position} on the waitlist.`}
            </p>
            {signed.result.crmContactId && <p className="result-sync">Synced to CRM</p>}
          </div>
        ) : (
          <>
            <label className="field field-email">
              <span>Email</span>
              <input name="email" type="email" autoComplete="email" autoCapitalize="none" spellCheck={false} required />
            </label>
            <div className="names">
              <label className="field">
                <span>
                  First name <em>optional</em>
                </span>
                <input name="firstName" autoComplete="given-name" />
              </label>
              <label className="field">
                <span>
                  Last name <em>optional</em>
                </span>
                <input name="lastName" autoComplete="family-name" />
              </label>
            </div>
            <button className="submit" disabled={pending}>
              {pending ? "Signing you up…" : full ? "Join the waitlist" : `Take seat ${spot.position}`}
            </button>
            {failed && (
              <p className="error" id="register-error" role="alert">
                Registration did not go through. Try again.
              </p>
            )}
          </>
        )}
      </form>
    </main>
  );
}

function rowKey(row: Row): string {
  switch (row.kind) {
    case "line":
      return `${row.list}-${row.number}`;
    case "range":
      return `${row.list}-${row.from}-${row.to}`;
    case "you":
      return "you";
    case "rule":
      return "rule";
  }
}

/**
 * One row of the sheet. The attendee's own row previews `draft` until they are signed, then
 * shows their name.
 */
function SheetRow({ row, signed, draft }: { row: Row; signed: Signed | null; draft: string }) {
  const prefix = (list: Spot["list"]) => (list === "waitlist" ? "W" : "");
  switch (row.kind) {
    case "rule":
      return (
        <li className="rule">
          <span className="rule-label">Capacity {row.capacity}. The waitlist starts here.</span>
        </li>
      );
    case "range":
      return (
        <li className="row row-range">
          <span className="row-num" />
          <span>
            {prefix(row.list)}
            {row.from}–{prefix(row.list)}
            {row.to} {row.state}
          </span>
        </li>
      );
    case "line":
      return (
        <li className={`row row-${row.state}`}>
          <span className="row-num">
            {prefix(row.list)}
            {row.number}
          </span>
          {row.state === "taken" ? <span className="row-state">taken</span> : <span className="visually-hidden">open</span>}
        </li>
      );
    case "you":
      return (
        <li className="row row-you">
          <span className="row-num">
            {row.number === undefined ? "Next" : `${prefix(row.list)}${row.number}`}
          </span>
          {signed ? (
            <span>
              <span className="row-name">{signed.name}</span>
              <span className="row-sub">{row.list === "seats" ? "Your seat" : "Your place on the waitlist"}</span>
            </span>
          ) : draft ? (
            // Hidden from screen readers so they do not echo every keystroke from the form.
            <span className="row-draft" aria-hidden="true">
              {draft}
            </span>
          ) : (
            <span className="row-draft row-draft-empty">{row.list === "seats" ? "Your seat" : "Your place"}</span>
          )}
        </li>
      );
  }
}
