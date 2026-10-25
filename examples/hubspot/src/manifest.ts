import type { Manifest } from "@totem/sdk";

const contact = {
  type: "object",
  required: ["contactId", "email", "firstName", "lastName"],
  properties: {
    contactId: { type: "string" },
    email: { type: "string" },
    firstName: { type: ["string", "null"] },
    lastName: { type: ["string", "null"] },
  },
  additionalProperties: false,
} as const;

export const manifest = {
  name: "hubspot",
  version: "0.1.0",
  protocol: "1",
  description: "Creates, updates and reads contacts in HubSpot CRM.",
  provides: {
    actions: {
      upsertContact: {
        description: "Create a contact, or update the contact with the same email.",
        input: {
          type: "object",
          required: ["email"],
          properties: {
            email: { type: "string" },
            firstName: { type: "string" },
            lastName: { type: "string" },
          },
          additionalProperties: false,
        },
        output: {
          type: "object",
          required: ["contactId", "created"],
          properties: {
            contactId: { type: "string" },
            created: { type: "boolean" },
          },
          additionalProperties: false,
        },
      },
      getContact: {
        description: "Read a contact by email. `contact` is null when HubSpot has none.",
        input: {
          type: "object",
          required: ["email"],
          properties: { email: { type: "string" } },
          additionalProperties: false,
        },
        output: {
          type: "object",
          required: ["contact"],
          properties: { contact: { anyOf: [contact, { type: "null" }] } },
          additionalProperties: false,
        },
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
} as const satisfies Manifest;
