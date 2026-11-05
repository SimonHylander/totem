import { spawn, type ChildProcess } from "node:child_process";
import { createPlatform, listen } from "@totem/platform";
import { serve } from "@totem/sdk/serve";
import { app as hubspot } from "@totem/example-hubspot";

const PLATFORM = "http://localhost:3000";
const EVENTS = "http://localhost:3003";

const clientId = process.env["HUBSPOT_CLIENT_ID"];
const clientSecret = process.env["HUBSPOT_CLIENT_SECRET"];
if (!clientId || !clientSecret) throw new Error("set HUBSPOT_CLIENT_ID and HUBSPOT_CLIENT_SECRET in examples/hubspot/.env.local");

// Call `process.exit` on Ctrl-C or SIGTERM, so the exit handlers stop the dev servers this script started.
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => process.exit(130));

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

const register = (url: string) => api<{ appId: string; secret: string }>(operator, "POST", "/api/apps", { url });

const hubspotApp = await register("http://localhost:3002/");
await serve(hubspot, { secret: hubspotApp.secret, port: 3002 });

// The events app runs in its own process, so it gets its secret and install through the environment.
const eventsApp = await register(`${EVENTS}/totem`);
const vite = await startEvents({});

for (const { appId } of [hubspotApp, eventsApp]) await api(operator, "POST", `/api/apps/${appId}/initialize`);
// Public apps appear on the events app's /integrations page (ADR 0015).
await api(operator, "PUT", `/api/apps/${hubspotApp.appId}/visibility`, { visibility: "public" });
const { redirectUri } = await api<{ redirectUri: string }>(operator, "PUT", `/api/apps/${hubspotApp.appId}/oauth-clients/hubspot`, {
  clientId,
  clientSecret,
});
const crm = await api<{ installId: string }>(tenantAdmin, "POST", "/api/tenants/acme/installs", { appId: hubspotApp.appId });
const events = await api<{ installId: string }>(tenantAdmin, "POST", "/api/tenants/acme/installs", {
  appId: eventsApp.appId,
  bindings: { upsertContact: { installId: crm.installId, action: "upsertContact" } },
});
const invoke = <T>(action: string, input: unknown) =>
  api<{ output: T }>(tenantAdmin, "POST", `/api/installs/${events.installId}/actions/${action}`, { input }).then((r) => r.output);
const launch = await invoke<{ eventId: string }>("createEvent", { name: "Totem launch", capacity: 2 });
await invoke("createEvent", { name: "HubSpot workshop", capacity: 20 });

await stop(vite);
await startEvents({ EVENTS_INSTALL_ID: events.installId });

console.log(`
The platform is on ${PLATFORM}, the HubSpot app is on :3002, and the events app (UI and Totem endpoint) is on :3003.
Tenant acme has one events install with two events. Its upsertContact port is bound to the tenant's HubSpot install.

1. If the HubSpot project in examples/hubspot/totem-test does not list this redirect URL, add it, then run pnpm hs:upload in examples/hubspot:
   ${redirectUri}

2. Connect HubSpot for tenant acme. On the integrations page, press "Connect". The switch on that page enables and disables HubSpot:
   ${EVENTS}/integrations
   Or sign in on the platform with the tenant admin token, then press "Connect":
   ${PLATFORM}/installs/${crm.installId}/connect/hubspot
   token: ${tenantAdmin}

3. Open the event list and register. "Totem launch" has 2 seats, so the third person joins the waitlist.
   Each registration becomes a HubSpot contact:
   ${EVENTS}/

4. List who registered for "Totem launch":
   curl -s -X POST ${PLATFORM}/api/installs/${events.installId}/actions/listAttendees \\
     -H 'authorization: Bearer ${tenantAdmin}' -H 'content-type: application/json' -d '{"input":{"eventId":"${launch.eventId}"}}'
`);

async function startEvents(extra: Record<string, string>) {
  const inUse = await fetch(EVENTS).then(() => true, () => false);
  if (inUse) throw new Error(`${EVENTS} is already in use`);
  const child = spawn("vite", ["dev", "--port", "3003", "--strictPort"], {
    env: { ...process.env, TOTEM_APP_SECRET: eventsApp.secret, TOTEM_PLATFORM_URL: `${PLATFORM}/rpc`, ...extra },
    stdio: "inherit",
  });
  process.on("exit", () => child.kill());
  const exited = new Promise<never>((_, reject) => child.once("exit", (code) => reject(new Error(`vite exited with ${code}`))));
  await Promise.race([waitFor(EVENTS), exited]);
  return child;
}

function stop(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    child.once("exit", () => resolve());
    child.kill();
  });
}

async function waitFor(url: string): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      await fetch(url);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error(`${url} did not start`);
}
