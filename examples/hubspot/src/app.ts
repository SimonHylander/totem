import { defineApp } from "@totem/sdk";
import { hubspot } from "./hubspot.js";
import { manifest } from "./manifest.js";

export const app = defineApp(manifest, {
  actions: {
    upsertContact: async ({ email, firstName, lastName }, ctx) => {
      const { accessToken } = await ctx.credentials.get("hubspot");
      const result = await hubspot(accessToken).upsertContact({
        email,
        ...(firstName !== undefined && { firstname: firstName }),
        ...(lastName !== undefined && { lastname: lastName }),
      });
      await ctx.log.info(result.created ? "contact created" : "contact updated", { contactId: result.contactId });
      return result;
    },

    getContact: async ({ email }, ctx) => {
      const { accessToken } = await ctx.credentials.get("hubspot");
      return { contact: await hubspot(accessToken).getContact(email) };
    },
  },
});
