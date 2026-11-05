import { Totem } from "@totem/sdk";
import { Effect } from "effect";
import { HubSpot } from "./hubspot.js";
import { manifest } from "./manifest.js";

export const app = Totem.App(
  { manifest, layer: HubSpot.layer },
  Effect.gen(function* () {
    const hubspot = yield* HubSpot;
    return {
      actions: {
        upsertContact: ({ email, firstName, lastName }, ctx) =>
          Effect.gen(function* () {
            const { accessToken } = yield* ctx.credentials.get("hubspot");
            const result = yield* hubspot.upsertContact(accessToken, {
              email,
              ...(firstName !== undefined && { firstname: firstName }),
              ...(lastName !== undefined && { lastname: lastName }),
            });
            yield* ctx.log.info(result.created ? "contact created" : "contact updated", { contactId: result.contactId });
            return result;
          }),

        getContact: ({ email }, ctx) =>
          Effect.gen(function* () {
            const { accessToken } = yield* ctx.credentials.get("hubspot");
            return { contact: yield* hubspot.getContact(accessToken, email) };
          }),
      },
    };
  }),
);
