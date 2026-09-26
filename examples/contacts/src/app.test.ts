import { describe, expect, it } from "vitest";
import { fakePlatform } from "@ipaas/sdk";
import { app } from "./app.js";

describe("createContact", () => {
  it("enriches through the port, stores state and returns the contact", async () => {
    const platform = fakePlatform(app, {
      credentials: { crm: { type: "apiKey", key: "k" } },
      ports: { enrichPerson: async () => ({ company: "Acme" }) },
    });

    const result = await app.invoke("createContact", { email: "ada@acme.com" }, { platform });

    expect(result).toEqual({ contactId: "c_ada", company: "Acme" });
    expect(platform.state.get("lastContactId")).toBe("c_ada");
    expect(platform.logs).toEqual([{ level: "info", message: "contact created", data: { contactId: "c_ada" } }]);
  });

  it("fails when the tenant has not connected the CRM", async () => {
    const platform = fakePlatform(app, { ports: { enrichPerson: async () => ({}) } });
    await expect(app.invoke("createContact", { email: "x@y.z" }, { platform })).rejects.toMatchObject({ code: -32002 });
  });
});
