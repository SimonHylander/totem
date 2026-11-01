import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { manifest } from "./manifest.js";

it("asks for the scopes the operator's HubSpot app requires", () => {
  const hsmeta: { config: { auth: { requiredScopes: string[] } } } = JSON.parse(
    readFileSync(new URL("../totem-test/src/app/app-hsmeta.json", import.meta.url), "utf8"),
  );
  expect([...hsmeta.config.auth.requiredScopes].sort()).toEqual([...manifest.needs.credentials.hubspot.scopes].sort());
});
