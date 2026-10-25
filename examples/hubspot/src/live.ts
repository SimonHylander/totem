import { createPlatform, listen } from "@totem/platform";
import { serve } from "@totem/sdk";
import { app } from "./app.js";

// Run the platform and this app against your HubSpot account. `pnpm live` reads .env.local:
//   HUBSPOT_CLIENT_ID      from the totem-test project's Auth tab
//   HUBSPOT_CLIENT_SECRET  same place. Never commit it.
// Management tokens are generated per run and printed below.

const PLATFORM = "http://localhost:3000";
const APP_PORT = 3002;

const clientId = process.env["HUBSPOT_CLIENT_ID"];
const clientSecret = process.env["HUBSPOT_CLIENT_SECRET"];
if (!clientId || !clientSecret) throw new Error("set HUBSPOT_CLIENT_ID and HUBSPOT_CLIENT_SECRET in .env.local");

const operator = crypto.randomUUID();
const tenantAdmin = crypto.randomUUID();
const platform = createPlatform({
  baseUrl: PLATFORM,
  allowLocalhost: true,
  principals: [
    { token: operator, principal: { id: "operator", role: { name: "operator" } } },
    { token: tenantAdmin, principal: { id: "tenant-admin", role: { name: "tenantAdmin", tenantId: "acme" } } },
  ],
});
await listen(platform.handle, PLATFORM);

/** Call the management API, and stop on any failure. */
async function api<T>(token: string, method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(PLATFORM + path, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  const json = await response.json();
  if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${JSON.stringify(json)}`);
  return json as T;
}

const { appId, secret } = await api<{ appId: string; secret: string }>(operator, "POST", "/api/apps", {
  url: `http://localhost:${APP_PORT}/`,
});
await serve(app, { secret, port: APP_PORT });
await api(operator, "POST", `/api/apps/${appId}/initialize`);
const { redirectUri } = await api<{ redirectUri: string }>(operator, "PUT", `/api/apps/${appId}/oauth-clients/hubspot`, {
  clientId,
  clientSecret,
});
const { installId } = await api<{ installId: string }>(tenantAdmin, "POST", "/api/tenants/acme/installs", { appId });

console.log(`
Platform on ${PLATFORM}, HubSpot app on :${APP_PORT}.

1. The HubSpot app must list this redirect URL. totem-test/src/app/app-hsmeta.json already does.
   Run pnpm hs:upload once so HubSpot has it.
   ${redirectUri}

2. Connect HubSpot for tenant acme. Sign in with the tenant admin token, then press Connect:
   ${PLATFORM}/installs/${installId}/connect/hubspot
   token: ${tenantAdmin}

3. Create a contact:
   curl -s -X POST ${PLATFORM}/api/installs/${installId}/actions/upsertContact \\
     -H 'authorization: Bearer ${tenantAdmin}' -H 'content-type: application/json' \\
     -d '{"input":{"email":"ada@example.com","firstName":"Ada"}}'
`);
