import { AppError } from "@totem/sdk";
import { Context, Effect, Layer, Schema } from "effect";

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

const HubSpotObject = Schema.Struct({
  id: Schema.String,
  properties: Schema.Struct({
    email: Schema.optionalKey(Schema.NullOr(Schema.String)),
    firstname: Schema.optionalKey(Schema.NullOr(Schema.String)),
    lastname: Schema.optionalKey(Schema.NullOr(Schema.String)),
  }),
});

const failed = (message: string, data?: unknown) => new AppError(HUBSPOT_REQUEST_FAILED, message, data);

const fromPromise = <A>(run: () => Promise<A>) =>
  Effect.tryPromise({ try: run, catch: (error) => failed(`HubSpot request failed: ${error instanceof Error ? error.message : String(error)}`) });

const parse = Effect.fnUntraced(function* (response: Response) {
  if (!response.ok) {
    const body = yield* fromPromise(() => response.text());
    return yield* Effect.fail(failed(`HubSpot returned ${response.status}`, { status: response.status, body }));
  }
  const json = yield* fromPromise(() => response.json());
  return yield* Schema.decodeUnknownEffect(HubSpotObject)(json).pipe(Effect.mapError((error) => failed(`HubSpot sent an unexpected body: ${error.message}`)));
});

function toContact({ id, properties }: typeof HubSpotObject.Type): Contact {
  return {
    contactId: id,
    email: properties.email ?? "",
    firstName: properties.firstname ?? null,
    lastName: properties.lastname ?? null,
  };
}

/** The HubSpot API. Every call takes the caller's access token, because tokens expire. */
export class HubSpot extends Context.Service<
  HubSpot,
  {
    getContact(accessToken: string, email: string): Effect.Effect<Contact | null, AppError>;
    /** Update by email, or create when HubSpot has no contact with that email. */
    upsertContact(accessToken: string, properties: ContactProperties & { email: string }): Effect.Effect<{ contactId: string; created: boolean }, AppError>;
  }
>()("@totem/example-hubspot/HubSpot") {
  static readonly layer = Layer.succeed(HubSpot, {
    getContact: Effect.fnUntraced(function* (accessToken, email) {
      const response = yield* request(accessToken, `/${encodeURIComponent(email)}?idProperty=email&properties=${PROPERTIES}`);
      if (response.status === 404) return null;
      return toContact(yield* parse(response));
    }),

    upsertContact: Effect.fnUntraced(function* (accessToken, properties) {
      const body = JSON.stringify({ properties });
      const updated = yield* request(accessToken, `/${encodeURIComponent(properties.email)}?idProperty=email`, { method: "PATCH", body });
      if (updated.status !== 404) return { contactId: (yield* parse(updated)).id, created: false };

      const created = yield* request(accessToken, "", { method: "POST", body });
      return { contactId: (yield* parse(created)).id, created: true };
    }),
  });
}

const request = (accessToken: string, path: string, init: RequestInit = {}) =>
  fromPromise(() =>
    fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    }),
  );
