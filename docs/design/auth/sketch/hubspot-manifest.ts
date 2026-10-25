import type { Manifest } from "./types.js";

// examples/hubspot/src/manifest.ts
//
// The operator's HubSpot developer app must list the same scopes as required scopes, and must
// list the platform's `redirectUri` as a redirect URL.

export const manifest = {
  name: "hubspot",
  version: "0.1.0",
  protocol: "1",
  description: "Creates, updates and reads contacts in HubSpot CRM.",
  provides: {
    actions: {
      upsertContact: {
        description: "Create a contact, or update the contact that has the same email.",
        input: {
          type: "object",
          required: ["email"],
          properties: {
            email: { type: "string", format: "email" },
            firstName: { type: "string" },
            lastName: { type: "string" },
          },
          additionalProperties: false,
        },
        output: {
          type: "object",
          required: ["contactId"],
          properties: {
            contactId: { type: "string" },
          },
          additionalProperties: false,
        },
      },
      getContact: {
        description: "Read a contact by email. `contact` is null when HubSpot has no such contact.",
        input: {
          type: "object",
          required: ["email"],
          properties: {
            email: { type: "string", format: "email" },
          },
          additionalProperties: false,
        },
        output: {
          type: "object",
          required: ["contact"],
          properties: {
            contact: {
              type: ["object", "null"],
              required: ["contactId", "email"],
              properties: {
                contactId: { type: "string" },
                email: { type: "string" },
                firstName: { type: ["string", "null"] },
                lastName: { type: ["string", "null"] },
              },
              additionalProperties: false,
            },
          },
          additionalProperties: false,
        },
      },
    },
  },
  needs: {
    credentials: {
      hubspot: {
        type: "oauth2",
        authorizeUrl: "https://app.hubspot.com/oauth/authorize",
        tokenUrl: "https://api.hubspot.com/oauth/v3/token",
        scopes: ["oauth", "crm.objects.contacts.read", "crm.objects.contacts.write"],
      },
    },
  },
} as const satisfies Manifest;
