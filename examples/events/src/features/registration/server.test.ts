import { describe, expect, it } from "vitest";
import { parseRegistration } from "./server.js";

describe("parseRegistration", () => {
  it("trims the fields and leaves out empty optional names", () => {
    expect(parseRegistration({ eventId: " e1 ", email: " ada@acme.com ", firstName: " Ada ", lastName: "" })).toEqual({
      eventId: "e1",
      email: "ada@acme.com",
      firstName: "Ada",
    });
  });

  it("rejects a missing or blank required field", () => {
    expect(() => parseRegistration({ eventId: "e1", email: "   " })).toThrow("email is required");
    expect(() => parseRegistration({ email: "ada@acme.com" })).toThrow("eventId is required");
    expect(() => parseRegistration(null)).toThrow("eventId is required");
  });

  it("rejects a blank or non-string optional name", () => {
    expect(() => parseRegistration({ eventId: "e1", email: "ada@acme.com", firstName: "  " })).toThrow("firstName is required");
    expect(() => parseRegistration({ eventId: "e1", email: "ada@acme.com", lastName: 7 })).toThrow("lastName is required");
  });
});
