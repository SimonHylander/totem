import { describe, expect, it } from "vitest";
import { field, port, portListings, providerAction } from "./ports.js";

const signature = { input: { type: "object" }, output: { type: "object" } } as const;
const hubspot = { appId: "a1", name: "hubspot", description: "CRM", actions: { upsertContact: signature } };
const mailer = { appId: "a2", name: "mailer", actions: { sendEmail: signature } };

describe("portListings", () => {
  it("lists only the apps that provide the port's action", () => {
    const [listing] = portListings([hubspot, mailer], { upsertContact: null });

    expect(listing).toMatchObject({
      port: "upsertContact",
      binding: null,
      candidates: [{ appId: "a1", name: "hubspot", description: "CRM" }],
    });
  });

  it("keeps a bound app that is not public, so it can be disabled", () => {
    const binding = { appId: "a3", name: "private-crm", action: "upsertContact", credentials: {} };
    const [listing] = portListings([hubspot], { upsertContact: binding });

    expect(listing?.candidates.map((app) => app.appId)).toEqual(["a1", "a3"]);
  });

  it("does not list a bound app twice", () => {
    const binding = { appId: "a1", name: "hubspot", action: "upsertContact", credentials: {} };
    const [listing] = portListings([hubspot], { upsertContact: binding });

    expect(listing?.candidates.map((app) => app.appId)).toEqual(["a1"]);
  });
});

describe("input checks", () => {
  it("binds a port to the provider action of the same name", () => {
    expect(providerAction(port({ port: "upsertContact" }))).toBe("upsertContact");
  });

  it("rejects an unknown port and a missing field", () => {
    expect(() => port({ port: "toString" })).toThrow("no port toString");
    expect(() => field({ appId: "" }, "appId")).toThrow("appId is required");
    expect(() => field(undefined, "appId")).toThrow("appId is required");
  });
});
