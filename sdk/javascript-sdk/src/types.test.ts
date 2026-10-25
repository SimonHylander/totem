import { describe, expectTypeOf, it } from "vitest";
import type { CredentialNeed, Manifest } from "@totem/protocol";
import { defineApp } from "./define-app.js";
import { fakePlatform } from "./fake-platform.js";

const manifest = {
  name: "creds",
  version: "0.1.0",
  protocol: "1",
  provides: { actions: { run: { input: { type: "object" }, output: { type: "object" } } } },
  needs: {
    credentials: {
      crm: {
        type: "oauth2",
        authorizeUrl: "https://crm.test/authorize",
        tokenUrl: "https://crm.test/token",
        scopes: ["contacts"],
      },
      mail: { type: "apiKey" },
    },
  },
} as const satisfies Manifest;

describe("credential types", () => {
  it("narrows credentials.get to the declared type", () => {
    defineApp(manifest, {
      actions: {
        run: async (_input, ctx) => {
          expectTypeOf(await ctx.credentials.get("crm")).toEqualTypeOf<{
            type: "oauth2";
            accessToken: string;
            expiresAt: string;
          }>();
          expectTypeOf(await ctx.credentials.get("mail")).toEqualTypeOf<{ type: "apiKey"; key: string }>();
          // @ts-expect-error undeclared credential
          await ctx.credentials.get("nope");
          return {};
        },
      },
    });
  });

  it("types fake credentials per name", () => {
    const app = defineApp(manifest, { actions: { run: async () => ({}) } });
    fakePlatform(app, { credentials: { mail: { type: "apiKey", key: "k" } } });
    // @ts-expect-error an apiKey value for an oauth2 credential
    fakePlatform(app, { credentials: { crm: { type: "apiKey", key: "k" } } });
  });

  it("rejects oauth2 needs without endpoints and plain-http endpoints", () => {
    // @ts-expect-error missing tokenUrl
    ({ type: "oauth2", authorizeUrl: "https://a.test/a", scopes: [] }) satisfies CredentialNeed;
    // @ts-expect-error http on a non-localhost host
    ({ type: "oauth2", authorizeUrl: "http://a.test/a", tokenUrl: "https://a.test/t", scopes: [] }) satisfies CredentialNeed;
  });
});
