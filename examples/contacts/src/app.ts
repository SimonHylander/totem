import { defineApp } from "@totem/sdk";
import { manifest } from "./manifest.js";

// Stand-in for a CRM client. A real app would call the CRM's HTTP API here.
async function crmCreateContact(apiKey: string, contact: { email: string; name?: string; pipeline?: string }) {
  void apiKey;
  return { id: `c_${contact.email.split("@")[0]}` };
}

export const app = defineApp(manifest, {
  actions: {
    createContact: async (input, ctx) => {
      const credential = await ctx.credentials.get("crm");

      const enriched = await ctx.ports.enrichPerson({ email: input.email });
      const contact = await crmCreateContact(credential.key, { ...input, pipeline: ctx.config.pipeline });

      await ctx.state.set("lastContactId", contact.id);
      await ctx.log.info("contact created", { contactId: contact.id });

      return { contactId: contact.id, company: enriched.company ?? null };
    },
  },
});
