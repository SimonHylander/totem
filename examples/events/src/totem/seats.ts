export type SeatStatus = "registered" | "waitlisted";

/**
 * A new registration is seated while a seat is left, otherwise it joins the waitlist. Shared by the app's
 * `register` and the registration page's preview of it, so this module imports nothing and the browser bundle
 * stays free of server code.
 */
export function statusFor(seatsLeft: number): SeatStatus {
  return seatsLeft > 0 ? "registered" : "waitlisted";
}
