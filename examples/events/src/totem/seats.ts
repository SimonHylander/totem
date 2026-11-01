// The seat rule, shared by the app's `register` and the registration page's preview of it.
// Imports nothing, so the browser bundle stays free of server code.

export type SeatStatus = "registered" | "waitlisted";

/** A new registration is seated while a seat is left, otherwise it joins the waitlist. */
export function statusFor(seatsLeft: number): SeatStatus {
  return seatsLeft > 0 ? "registered" : "waitlisted";
}
