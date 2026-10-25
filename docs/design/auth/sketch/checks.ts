import type { CredentialNeed, CredentialValueFor } from "./types.js";
import type { manifest } from "./hubspot-manifest.js";

// Compile-time checks for the sketch. `tsc` fails if a claim below stops holding.

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

// The SDK change in sdk/javascript-sdk/src/types.ts: `credentials.get(name)` returns the value
// for the declared type. The HubSpot handler reads `accessToken` with no runtime type check.
type Needs<M> = M extends { needs: { credentials: infer C } } ? C : never;
type HubSpotValue = CredentialValueFor<Needs<typeof manifest>["hubspot"]>;
true satisfies Equal<HubSpotValue, { type: "oauth2"; accessToken: string; expiresAt: string }>;

// Each credential type carries only its own fields, and endpoints must be https or localhost.
// @ts-expect-error an oauth2 need without a token URL
({ type: "oauth2", authorizeUrl: "https://example.com/authorize", scopes: [] }) satisfies CredentialNeed;
// @ts-expect-error a plain-http endpoint that is not localhost
({ type: "oauth2", authorizeUrl: "http://example.com/a", tokenUrl: "https://example.com/t", scopes: [] }) satisfies CredentialNeed;
// @ts-expect-error an apiKey need with scopes
({ type: "apiKey", scopes: ["contacts"] }) satisfies CredentialNeed;
// A localhost endpoint is allowed for development.
({ type: "oauth2", authorizeUrl: "http://localhost:8080/a", tokenUrl: "http://localhost:8080/t", scopes: [] }) satisfies CredentialNeed;
