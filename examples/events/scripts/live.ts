import { spawn, type ChildProcess } from "node:child_process";
import { renameSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createPlatform, listen } from "@totem/platform";
import { serve } from "@totem/sdk";
import { app as hubspot } from "@totem/example-hubspot";

const PLATFORM = "http://localhost:3000";
const EVENTS = "http://localhost:3003";
const VITE_BIN = fileURLToPath(new URL("bin/vite.js", import.meta.resolve("vite/package.json")));

const clientId = process.env["HUBSPOT_CLIENT_ID"];
const clientSecret = process.env["HUBSPOT_CLIENT_SECRET"];
if (!clientId || !clientSecret) throw new Error("set HUBSPOT_CLIENT_ID and HUBSPOT_CLIENT_SECRET in examples/hubspot/.env.local");

const exitToStopDevServers = () => process.exit(130);
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, exitToStopDevServers);

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

const eventsApp = await register(`${EVENTS}/totem`);
const vite = await startEvents({});

for (const { appId } of [hubspotApp, eventsApp]) await api(operator, "POST", `/api/apps/${appId}/initialize`);
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
Platform on ${PLATFORM}. HubSpot app on :3002, events app (UI and Totem endpoint) on :3003.
Tenant acme has one events install, bound to its HubSpot install, with two events.

1. HubSpot must list this redirect URL (examples/hubspot/totem-test, pnpm hs:upload):
   ${redirectUri}

2. Connect HubSpot for tenant acme. Press "Connect hubspot" on the integrations page, which also
   enables and disables HubSpot:
   ${EVENTS}/integrations
   Or sign in on the platform with the tenant admin token, then press Connect:
   ${PLATFORM}/installs/${crm.installId}/connect/hubspot
   token: ${tenantAdmin}

3. Open the events and register. "Totem launch" holds 2, so the third person is waitlisted.
   Each registration becomes a HubSpot contact:
   ${EVENTS}/

4. See who registered for Totem launch:
   curl -s -X POST ${PLATFORM}/api/installs/${events.installId}/actions/listAttendees \\
     -H 'authorization: Bearer ${tenantAdmin}' -H 'content-type: application/json' -d '{"input":{"eventId":"${launch.eventId}"}}'
`);

const readyFile = process.env["TOTEM_READY_FILE"];
if (readyFile) {
  writeFileAtomically(
    readyFile,
    JSON.stringify({ token: tenantAdmin, crmInstall: crm.installId, eventsInstall: events.installId, eventId: launch.eventId }),
  );
}

function writeFileAtomically(path: string, contents: string) {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, contents);
  renameSync(tmp, path);
}

async function startEvents(extra: Record<string, string>) {
  const child = spawn(process.execPath, [VITE_BIN, "dev", "--port", "3003", "--strictPort"], {
    env: { ...process.env, TOTEM_APP_SECRET: eventsApp.secret, TOTEM_PLATFORM_URL: `${PLATFORM}/rpc`, ...extra },
    stdio: "inherit",
  });
  process.on("exit", () => child.kill());
  const exitedBeforeAnswering = new Promise<never>((_, reject) => child.once("exit", (code) => reject(new Error(`vite exited with ${code}`))));
  await Promise.race([waitFor(EVENTS), exitedBeforeAnswering]);
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
