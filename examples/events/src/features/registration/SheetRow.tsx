import type { Row, Spot } from "./sheet.js";
import type { registerAttendee } from "./server.js";

/** What the attendee wrote on their line, shown once they hold it. */
export type Signed = { result: Awaited<ReturnType<typeof registerAttendee>>; name: string };

export function rowKey(row: Row): string {
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
export function SheetRow({ row, signed, draft }: { row: Row; signed: Signed | null; draft: string }) {
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
