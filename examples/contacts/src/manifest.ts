import type { Manifest } from "@ipaas/sdk";

export const manifest = {
  name: "contacts",
  version: "0.1.0",
  protocol: "1",
  description: "Creates contacts in a CRM, enriched through whatever the tenant has installed.",
  provides: {
    actions: {
      createContact: {
        description: "Create a contact from an email address.",
        input: {
          type: "object",
          required: ["email"],
          properties: {
            email: { type: "string" },
            name: { type: "string" },
          },
          additionalProperties: false,
        },
        output: {
          type: "object",
          required: ["contactId", "company"],
          properties: {
            contactId: { type: "string" },
            company: { type: ["string", "null"] },
          },
          additionalProperties: false,
        },
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
        input: {
          type: "object",
          required: ["email"],
          properties: { email: { type: "string" } },
          additionalProperties: false,
        },
        output: {
          type: "object",
          properties: { company: { type: "string" } },
          additionalProperties: false,
        },
      },
    },
  },
  config: {
    type: "object",
    properties: {
      pipeline: { type: "string" },
    },
    additionalProperties: false,
  },
} as const satisfies Manifest;
