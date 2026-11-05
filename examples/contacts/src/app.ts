import { Totem } from "@totem/sdk";
import { Effect } from "effect";
import { manifest } from "./manifest.js";

// Stand-in for a CRM client. A real app would call the CRM's HTTP API here.
const crmCreateContact = (apiKey: string, contact: { email: string; name?: string; pipeline?: string }) =>
  Effect.sync(() => {
    void apiKey;
    return { id: `c_${contact.email.split("@")[0]}` };
  });

export const handlers: Totem.Handlers<typeof manifest> = {
  actions: {
    createContact: (input, ctx) =>
      Effect.gen(function* () {
        const credential = yield* ctx.credentials.get("crm");

        const enriched = yield* ctx.ports.enrichPerson({ email: input.email });
        const contact = yield* crmCreateContact(credential.key, {
          ...input,
          ...(ctx.config.pipeline !== undefined && { pipeline: ctx.config.pipeline }),
        });

        yield* ctx.state.set("lastContactId", contact.id);
        yield* ctx.log.info("contact created", { contactId: contact.id });

        return { contactId: contact.id, company: enriched.company ?? null };
      }),
  },
};

export const app = Totem.App({ manifest }, Effect.succeed(handlers));
