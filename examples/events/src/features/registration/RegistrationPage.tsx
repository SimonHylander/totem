import { useState, type FormEvent } from "react";
import { getRouteApi } from "@tanstack/react-router";
import { Schema } from "effect";
import { Registration, registerAttendee } from "./server.js";
import { nextSpot, sheetRows, takenWith, type Spot } from "./sheet.js";
import { SheetRow, rowKey, type Signed } from "./SheetRow.js";

// Anyone with the URL can register. The app decides who may trigger its actions (ADR 0014).

const route = getRouteApi("/events/$eventId");

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

export function RegistrationPage() {
  const event = route.useLoaderData();
  const { eventId } = route.useParams();
  const [signed, setSigned] = useState<Signed | null>(null);
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState(false);
  const [draft, setDraft] = useState("");

  const taken = event.capacity - event.seatsLeft;
  const spot: Spot = signed
    ? { list: signed.result.status === "registered" ? "seats" : "waitlist", position: signed.result.position }
    : nextSpot(event.capacity, event.seatsLeft);
  const rows = sheetRows(event.capacity, signed ? takenWith(taken, spot) : taken, spot);
  const full = event.seatsLeft === 0;

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = Object.fromEntries(new FormData(e.currentTarget));
    const data = Schema.decodeUnknownSync(Registration)({ ...form, eventId });
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

// Covers an unknown event and a platform that cannot be reached alike. The server log has the cause.
export function RegistrationError() {
  return (
    <main>
      <h1 className="title">Event not found</h1>
      <p className="notice">This event could not be loaded. Check the link, or reload the page to try again.</p>
    </main>
  );
}
