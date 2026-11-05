import { describe, expect, it } from "vitest";
import { registration } from "./server.js";

describe("registration", () => {
  it("trims the fields and leaves out empty optional names", () => {
    expect(registration({ eventId: " e1 ", email: " ada@acme.com ", firstName: " Ada ", lastName: "" })).toEqual({
      eventId: "e1",
      email: "ada@acme.com",
      firstName: "Ada",
    });
  });

  it("rejects a missing or blank required field", () => {
    expect(() => registration({ eventId: "e1", email: "   " })).toThrow("email is required");
    expect(() => registration({ email: "ada@acme.com" })).toThrow("eventId is required");
    expect(() => registration(null)).toThrow("eventId is required");
  });

  it("rejects a blank or non-string optional name", () => {
    expect(() => registration({ eventId: "e1", email: "ada@acme.com", firstName: "  " })).toThrow("firstName is required");
    expect(() => registration({ eventId: "e1", email: "ada@acme.com", lastName: 7 })).toThrow("lastName is required");
  });
});
