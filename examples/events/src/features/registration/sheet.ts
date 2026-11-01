import { statusFor } from "../../totem/seats.js";

/** Where the attendee's own line sits. `position` is unknown on the waitlist until they register. */
export type Spot = { list: "seats" | "waitlist"; position: number | undefined };

export type Row =
  | { kind: "line"; list: Spot["list"]; number: number; state: "taken" | "open" }
  | { kind: "range"; list: Spot["list"]; from: number; to: number; state: "taken" | "open" }
  | { kind: "you"; list: Spot["list"]; number: number | undefined }
  | { kind: "rule"; capacity: number };

/** The spot a new registration would get: the next free seat, or the waitlist when the event is full. */
export function nextSpot(capacity: number, seatsLeft: number): Spot {
  return statusFor(seatsLeft) === "registered" ? { list: "seats", position: capacity - seatsLeft + 1 } : { list: "waitlist", position: undefined };
}

/**
 * Seats taken once the attendee holds `you`. Their own seat counts as taken, even when it is a
 * seat they held before and the event's count already includes it.
 */
export function takenWith(taken: number, you: Spot): number {
  return you.list === "seats" ? Math.max(taken + 1, you.position ?? 0) : taken;
}

/**
 * The rows to draw for an event, around the attendee's spot. An event's capacity is a list of numbered lines
 * and the waitlist continues below them. Long runs of taken or open lines collapse into one range row, so an
 * event of 500 seats draws about as many rows as one of 20. `taken` counts registered seats, including the
 * attendee's own once they hold one.
 */
export function sheetRows(capacity: number, taken: number, you: Spot): Row[] {
  if (you.list === "waitlist") {
    const ahead = (you.position ?? 1) - 1;
    return [
      ...run("seats", "taken", 1, capacity, 1, 1),
      { kind: "rule", capacity },
      ...run("waitlist", "taken", 1, ahead, 1, 1),
      { kind: "you", list: "waitlist", number: you.position },
    ];
  }
  const seat = you.position ?? taken + 1;
  return [
    ...run("seats", "taken", 1, seat - 1, 1, 1),
    { kind: "you", list: "seats", number: seat },
    ...run("seats", "taken", seat + 1, Math.max(taken, seat), 1, 1),
    ...run("seats", "open", Math.max(taken, seat) + 1, capacity, 2, 0),
    { kind: "rule", capacity },
  ];
}

function run(list: Spot["list"], state: "taken" | "open", from: number, to: number, head: number, tail: number): Row[] {
  const count = to - from + 1;
  if (count <= 0) return [];
  const line = (number: number): Row => ({ kind: "line", list, number, state });
  const hidden = count - head - tail;
  if (hidden <= 1) return Array.from({ length: count }, (_, i) => line(from + i));
  return [
    ...Array.from({ length: head }, (_, i) => line(from + i)),
    { kind: "range", list, from: from + head, to: to - tail, state },
    ...Array.from({ length: tail }, (_, i) => line(to - tail + 1 + i)),
  ];
}
