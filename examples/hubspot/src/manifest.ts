import { Totem } from "@totem/sdk";
import { Schema } from "effect";

const Contact = Schema.Struct({
  contactId: Schema.String,
  email: Schema.String,
  firstName: Schema.NullOr(Schema.String),
  lastName: Schema.NullOr(Schema.String),
});

export const manifest = Totem.Manifest({
  name: "hubspot",
  version: "0.1.0",
  description: "Creates, updates and reads contacts in HubSpot CRM.",
  provides: {
    actions: {
      upsertContact: {
        description: "Create a contact, or update the contact with the same email.",
        input: Schema.Struct({
          email: Schema.String,
          firstName: Schema.optionalKey(Schema.String),
          lastName: Schema.optionalKey(Schema.String),
        }),
        output: Schema.Struct({ contactId: Schema.String, created: Schema.Boolean }),
      },
      getContact: {
        description: "Read a contact by email. `contact` is null when HubSpot has none.",
        input: Schema.Struct({ email: Schema.String }),
        output: Schema.Struct({ contact: Schema.NullOr(Contact) }),
      },
    },
  },
  needs: {
    credentials: {
      // The operator's HubSpot app (totem-test/src/app/app-hsmeta.json) must list these scopes
      // and the platform's redirect URI for this binding.
      hubspot: {
        type: "oauth2",
        authorizeUrl: "https://app.hubspot.com/oauth/authorize",
        tokenUrl: "https://api.hubspot.com/oauth/v3/token",
        scopes: ["oauth", "crm.objects.contacts.read", "crm.objects.contacts.write"],
      },
    },
  },
});
