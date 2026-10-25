import { createPlatform, listen } from "@totem/platform";
import { serve, type App, type Manifest } from "@totem/sdk";
import { app as hubspot } from "@totem/example-hubspot";
import { app as events } from "./app.js";

// Run the platform with the events app driving the hubspot app through its upsertContact port.
// `pnpm live` at the repo root builds and starts it. HubSpot credentials come from
// examples/hubspot/.env.local (HUBSPOT_CLIENT_ID, HUBSPOT_CLIENT_SECRET).

const PLATFORM = "http://localhost:3000";

const clientId = process.env["HUBSPOT_CLIENT_ID"];
const clientSecret = process.env["HUBSPOT_CLIENT_SECRET"];
if (!clientId || !clientSecret) throw new Error("set HUBSPOT_CLIENT_ID and HUBSPOT_CLIENT_SECRET in examples/hubspot/.env.local");

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

/** Register an app, serve it with its new secret, and pull its manifest. */
async function start<M extends Manifest>(app: App<M>, port: number): Promise<string> {
  const { appId, secret } = await api<{ appId: string; secret: string }>(operator, "POST", "/api/apps", {
    url: `http://localhost:${port}/`,
  });
  await serve(app, { secret, port });
  await api(operator, "POST", `/api/apps/${appId}/initialize`);
  return appId;
}

const hubspotApp = await start(hubspot, 3002);
const eventsApp = await start(events, 3003);
const { redirectUri } = await api<{ redirectUri: string }>(operator, "PUT", `/api/apps/${hubspotApp}/oauth-clients/hubspot`, {
  clientId,
  clientSecret,
});

const crm = await api<{ installId: string }>(tenantAdmin, "POST", "/api/tenants/acme/installs", { appId: hubspotApp });
const event = await api<{ installId: string }>(tenantAdmin, "POST", "/api/tenants/acme/installs", {
  appId: eventsApp,
  config: { eventName: "Totem launch", capacity: 2 },
  bindings: { upsertContact: { installId: crm.installId, action: "upsertContact" } },
});

const invoke = (action: string, input: string) =>
  `curl -s -X POST ${PLATFORM}/api/installs/${event.installId}/actions/${action} \\
     -H 'authorization: Bearer ${tenantAdmin}' -H 'content-type: application/json' -d '${input}'`;

console.log(`
Platform on ${PLATFORM}. HubSpot app on :3002, events app on :3003.
The events install's upsertContact port is bound to the HubSpot install.

1. HubSpot must list this redirect URL (examples/hubspot/totem-test, pnpm hs:upload):
   ${redirectUri}

2. Connect HubSpot for tenant acme. Sign in with the tenant admin token, then press Connect:
   ${PLATFORM}/installs/${crm.installId}/connect/hubspot
   token: ${tenantAdmin}

3. Register attendees. The event holds 2, so the third is waitlisted. Each one becomes a HubSpot contact:
   ${invoke("register", '{"input":{"email":"ada@example.com","firstName":"Ada"}}')}

4. Check in and list:
   ${invoke("checkIn", '{"input":{"email":"ada@example.com"}}')}
   ${invoke("listAttendees", '{"input":{}}')}
`);
