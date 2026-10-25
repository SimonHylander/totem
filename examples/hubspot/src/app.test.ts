import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakePlatform } from "@totem/sdk";
import { app } from "./app.js";

const credentials = { hubspot: { type: "oauth2", accessToken: "tok", expiresAt: "2030-01-01T00:00:00Z" } } as const;

type Stored = { id: string; properties: Record<string, string> };

/** In-memory stand-in for the HubSpot contacts endpoints the app calls. */
function fakeHubSpot() {
  const contacts = new Map<string, Stored>();
  const requests: { method: string; url: string; authorization: string | null }[] = [];

  const handler = async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const method = init.method ?? "GET";
    requests.push({ method, url: url.pathname + url.search, authorization: new Headers(init.headers).get("authorization") });
    const email = decodeURIComponent(url.pathname.split("/").at(-1) ?? "");
    const body = init.body ? (JSON.parse(String(init.body)) as { properties: Record<string, string> }) : null;

    if (method === "POST") {
      const stored = { id: String(contacts.size + 1), properties: body!.properties };
      contacts.set(stored.properties["email"]!, stored);
      return Response.json(stored, { status: 201 });
    }
    const existing = contacts.get(email);
    if (!existing) return Response.json({ message: "not found" }, { status: 404 });
    if (method === "PATCH") Object.assign(existing.properties, body!.properties);
    return Response.json(existing);
  };

  return { contacts, requests, handler };
}

let hub: ReturnType<typeof fakeHubSpot>;

beforeEach(() => {
  hub = fakeHubSpot();
  vi.stubGlobal("fetch", vi.fn(hub.handler));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("upsertContact", () => {
  it("creates a missing contact, then updates it by email", async () => {
    const platform = fakePlatform(app, { credentials });

    const first = await app.invoke("upsertContact", { email: "ada@acme.com", firstName: "Ada" }, { platform });
    const second = await app.invoke("upsertContact", { email: "ada@acme.com", lastName: "Lovelace" }, { platform });

    expect(first).toEqual({ contactId: "1", created: true });
    expect(second).toEqual({ contactId: "1", created: false });
    expect(hub.contacts.get("ada@acme.com")?.properties).toEqual({
      email: "ada@acme.com",
      firstname: "Ada",
      lastname: "Lovelace",
    });
    expect(hub.requests.map((r) => `${r.method} ${r.url} ${r.authorization}`)).toEqual([
      "PATCH /crm/v3/objects/contacts/ada%40acme.com?idProperty=email Bearer tok",
      "POST /crm/v3/objects/contacts Bearer tok",
      "PATCH /crm/v3/objects/contacts/ada%40acme.com?idProperty=email Bearer tok",
    ]);
    expect(platform.logs).toEqual([
      { level: "info", message: "contact created", data: { contactId: "1" } },
      { level: "info", message: "contact updated", data: { contactId: "1" } },
    ]);
  });

  it("reports a HubSpot failure as an app error with the status", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("rate limited", { status: 429 })));
    const platform = fakePlatform(app, { credentials });

    await expect(app.invoke("upsertContact", { email: "x@y.z" }, { platform })).rejects.toMatchObject({
      code: 1001,
      data: { status: 429, body: "rate limited" },
    });
  });

  it("fails when the tenant has not connected HubSpot", async () => {
    const platform = fakePlatform(app);
    await expect(app.invoke("upsertContact", { email: "x@y.z" }, { platform })).rejects.toMatchObject({ code: -32002 });
  });
});

describe("getContact", () => {
  it("returns the contact by email, or null when HubSpot has none", async () => {
    hub.contacts.set("ada@acme.com", { id: "7", properties: { email: "ada@acme.com", firstname: "Ada" } });
    const platform = fakePlatform(app, { credentials });

    expect(await app.invoke("getContact", { email: "ada@acme.com" }, { platform })).toEqual({
      contact: { contactId: "7", email: "ada@acme.com", firstName: "Ada", lastName: null },
    });
    expect(await app.invoke("getContact", { email: "nobody@acme.com" }, { platform })).toEqual({ contact: null });
  });
});
