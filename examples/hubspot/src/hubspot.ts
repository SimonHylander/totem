import { AppError } from "@totem/sdk";

// Thin client for the HubSpot CRM contacts API (v3). Contacts are addressed by email through
// `idProperty=email`, so callers never handle HubSpot record IDs on input.

const BASE_URL = "https://api.hubapi.com/crm/v3/objects/contacts";
const PROPERTIES = "email,firstname,lastname";

/** Any non-2xx response other than the 404s handled below. `data` carries the status and body. */
export const HUBSPOT_REQUEST_FAILED = 1001;

export type Contact = {
  contactId: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
};

type ContactProperties = { email?: string; firstname?: string; lastname?: string };

type HubSpotObject = {
  id: string;
  properties: { email?: string | null; firstname?: string | null; lastname?: string | null };
};

/** Bind the client to one access token. Create a new client per call, because tokens expire. */
export function hubspot(accessToken: string) {
  const request = (path: string, init: RequestInit = {}) =>
    fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    });

  return {
    async getContact(email: string): Promise<Contact | null> {
      const response = await request(`/${encodeURIComponent(email)}?idProperty=email&properties=${PROPERTIES}`);
      if (response.status === 404) return null;
      return toContact(await parse(response));
    },

    /** Update by email, or create when HubSpot has no contact with that email. */
    async upsertContact(properties: ContactProperties & { email: string }): Promise<{ contactId: string; created: boolean }> {
      const body = JSON.stringify({ properties });
      const updated = await request(`/${encodeURIComponent(properties.email)}?idProperty=email`, { method: "PATCH", body });
      if (updated.status !== 404) return { contactId: (await parse(updated)).id, created: false };

      const created = await request("", { method: "POST", body });
      return { contactId: (await parse(created)).id, created: true };
    },
  };
}

async function parse(response: Response): Promise<HubSpotObject> {
  if (!response.ok) {
    throw new AppError(HUBSPOT_REQUEST_FAILED, `HubSpot returned ${response.status}`, {
      status: response.status,
      body: await response.text(),
    });
  }
  return (await response.json()) as HubSpotObject;
}

function toContact({ id, properties }: HubSpotObject): Contact {
  return {
    contactId: id,
    email: properties.email ?? "",
    firstName: properties.firstname ?? null,
    lastName: properties.lastname ?? null,
  };
}
