import assert from "node:assert/strict";
import { createPlatform, listen } from "@totem/platform";
import { defineApp, serve, type Manifest } from "@totem/sdk";
import { Context, Layer, Logger, Option, Tracer } from "effect";
import { app } from "./app.js";

// The verify-totem run: boot the platform and two apps over real HTTP, drive the management API
// through every step of an install, and check the result and the trace. Exits non-zero on the first
// failure. `pnpm verify:live` at the repo root builds and runs it.

const PLATFORM = "http://localhost:3100";
const CONTACTS = "http://localhost:3101/";
const ENRICHER = "http://localhost:3102/";

/** The provider for contacts' enrichPerson port. */
const enricher = defineApp(
  {
    name: "enricher",
    version: "0.1.0",
    protocol: "1",
    provides: {
      actions: {
        enrichPerson: {
          input: { type: "object", required: ["email"], properties: { email: { type: "string" } } },
          output: { type: "object", properties: { company: { type: "string" } } },
        },
      },
    },
    needs: {},
  } as const satisfies Manifest,
  { actions: { enrichPerson: async ({ email }) => ({ company: email.endsWith("@acme.test") ? "Acme" : "Unknown" }) } },
);

/** What the contacts app saw on its last createContact: its config, its key and its stored state. */
const seen: { pipeline?: string | undefined; key?: string; lastContactId?: unknown } = {};
const contacts = defineApp(app.manifest, {
  actions: {
    createContact: async (input, ctx) => {
      const output = await app.handlers.actions.createContact(input, ctx);
      seen.pipeline = ctx.config.pipeline;
      seen.key = (await ctx.credentials.get("crm")).key;
      seen.lastContactId = await ctx.state.get("lastContactId");
      return output;
    },
  },
});

const spans: Tracer.Span[] = [];
const tracer = Tracer.make({
  span: (options) => {
    const span = new Tracer.NativeSpan(options);
    spans.push(span);
    return span;
  },
});

/** Platform log lines with the trace they were written in. */
const logs: { message: unknown; traceId: string | undefined }[] = [];
const logRecorder = Logger.make(({ message, fiber }) => {
  const span = Context.getOption(fiber.context, Tracer.ParentSpan);
  logs.push({ message, traceId: Option.isSome(span) ? span.value.traceId : undefined });
});

const operator = crypto.randomUUID();
const tenantAdmin = crypto.randomUUID();
const platform = createPlatform(
  {
    baseUrl: PLATFORM,
    allowLocalhost: true,
    principals: [
      { token: operator, principal: { id: "operator", role: { name: "operator" } } },
      { token: tenantAdmin, principal: { id: "tenant-admin", role: { name: "tenantAdmin", tenantId: "acme" } } },
    ],
  },
  Layer.merge(Layer.succeed(Tracer.Tracer, tracer), Logger.layer([logRecorder], { mergeWithExisting: true })),
);
await listen(platform.handle, PLATFORM);

/** Call the management API, and stop on any failure. */
async function api<T>(token: string, method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  const response = await fetch(PLATFORM + path, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...headers },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  const json: unknown = await response.json();
  assert.ok(response.ok, `${method} ${path}: ${response.status} ${JSON.stringify(json)}`);
  return json as T;
}

const step = (name: string) => console.log(`verify-totem: ${name}`);

step("register and initialize");
const contactsApp = await api<{ appId: string; secret: string }>(operator, "POST", "/api/apps", { url: CONTACTS });
const enricherApp = await api<{ appId: string; secret: string }>(operator, "POST", "/api/apps", { url: ENRICHER });
const servers = [
  await serve(contacts, { secret: contactsApp.secret, port: Number(new URL(CONTACTS).port), platformUrl: `${PLATFORM}/rpc` }),
  await serve(enricher, { secret: enricherApp.secret, port: Number(new URL(ENRICHER).port), platformUrl: `${PLATFORM}/rpc` }),
];
for (const { appId } of [contactsApp, enricherApp]) await api(operator, "POST", `/api/apps/${appId}/initialize`);

step("install with a bound port");
const provider = await api<{ installId: string }>(tenantAdmin, "POST", "/api/tenants/acme/installs", { appId: enricherApp.appId });
const { installId } = await api<{ installId: string }>(tenantAdmin, "POST", "/api/tenants/acme/installs", {
  appId: contactsApp.appId,
  config: { pipeline: "sales" },
  bindings: { enrichPerson: { installId: provider.installId, action: "enrichPerson" } },
});

step("connect an API key");
await api(tenantAdmin, "PUT", `/api/installs/${installId}/connections/crm/api-key`, { key: "crm-key" });

step("invoke, which calls the bound port");
const traceId = crypto.randomUUID().replaceAll("-", "");
const { output } = await api<{ output: unknown }>(
  tenantAdmin,
  "POST",
  `/api/installs/${installId}/actions/createContact`,
  { input: { email: "ada@acme.test", name: "Ada" } },
  { traceparent: `00-${traceId}-${"1".repeat(16)}-01` },
);
assert.deepEqual(output, { contactId: "c_ada", company: "Acme" });
assert.deepEqual(seen, { pipeline: "sales", key: "crm-key", lastContactId: "c_ada" });

step("check the trace");
const expected = [
  "POST /api/installs/:installId/actions/:action",
  "invoke createContact",
  "rpc credentials/get",
  "rpc actions/invoke",
  "invoke enrichPerson",
  "rpc state/set",
  "rpc state/get",
];
for (const name of expected) {
  const span = spans.find((s) => s.name === name);
  assert.ok(span, `no span "${name}" in ${spans.map((s) => s.name).join(", ")}`);
  assert.equal(span.traceId, traceId, `span "${name}" is in another trace`);
}
const created = logs.find(({ message }) => Array.isArray(message) && message[0] === "contact created");
assert.ok(created, "the app's log line did not reach the platform");
assert.equal(created.traceId, traceId, "the app's log line is in another trace");

step("ok");
for (const server of servers) server.close();
process.exit(0);
