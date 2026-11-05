import { Totem } from "@totem/sdk";
import { Schema } from "effect";

export const manifest = Totem.Manifest({
  name: "contacts",
  version: "0.1.0",
  description: "Creates contacts in a CRM, enriched through whatever the tenant has installed.",
  provides: {
    actions: {
      createContact: {
        description: "Create a contact from an email address.",
        input: Schema.Struct({ email: Schema.String, name: Schema.optionalKey(Schema.String) }),
        output: Schema.Struct({ contactId: Schema.String, company: Schema.NullOr(Schema.String) }),
      },
    },
  },
  needs: {
    credentials: {
      crm: { type: "apiKey" },
    },
    state: true,
    actions: {
      enrichPerson: {
        description: "Look up a person by email.",
        input: Schema.Struct({ email: Schema.String }),
        output: Schema.Struct({ company: Schema.optionalKey(Schema.String) }),
      },
    },
  },
  config: Schema.Struct({ pipeline: Schema.optionalKey(Schema.String) }),
});
