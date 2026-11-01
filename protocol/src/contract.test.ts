import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";
import type {
  AppMethods,
  CallContext,
  InstallContext,
  LogLevel,
  Manifest,
  PlatformMethods,
  SignedPlatformMethods,
} from "./types.js";

// The JSON Schemas are the contract (ADR 0004) and types.ts mirrors them by hand. Each fixture below
// is typed with the TypeScript mirror and validated against the schema, so a field that one side
// adds, removes or renames fails here. The mapped fixture types force at least one fixture per
// TypeScript method, and the method lists are compared with the schemas' `$defs`. Fixtures fill every
// optional field and every union member, so a rename on either side cannot go unexercised.

const schema = (file: string) => JSON.parse(readFileSync(new URL(`../${file}`, import.meta.url), "utf8")) as { $id: string; $defs?: object };
const files = ["manifest", "context", "app-methods", "platform-methods", "trace"].map((name) => schema(`${name}.schema.json`));

// Manifests reference the draft 2020-12 meta-schema, which needs non-strict mode (protocol/README.md).
const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats.default(ajv);
for (const file of files) ajv.addSchema(file);

const idOf = (name: string) => `https://totem.dev/protocol/1/${name}.schema.json`;
/** A `$defs` entry's `params` or `result` schema. Method names hold "/", which JSON Pointer escapes as "~1". */
const methodRef = (file: string, method: string, part: "params" | "result") =>
  `${idOf(file)}#/$defs/${method.replaceAll("/", "~1")}/${part}`;
const valid = (ref: string, value: unknown) => {
  const validate = ajv.getSchema(ref);
  if (!validate) throw new Error(`no schema ${ref}`);
  return validate(value) ? true : validate.errors;
};

/** One or more `{ params, result }` cases per method. */
type Fixtures<M> = { [K in keyof M]: readonly [M[K], ...M[K][]] };

const context = { tenantId: "acme", installId: "i-1", config: { region: "eu" } } satisfies InstallContext;
const callContext = {
  ...context,
  callId: "c-1",
  idempotencyKey: "k-1",
  deadline: "2026-10-28T12:00:30Z",
} satisfies Required<CallContext>;

const manifest: Manifest = {
  name: "crm",
  version: "0.1.0",
  protocol: "1",
  description: "A CRM connector",
  provides: {
    actions: { upsert: { description: "Upsert a contact", input: { type: "object" }, output: { type: "object" } } },
    triggers: { created: { description: "A contact was created", payload: { type: "object" } } },
  },
  needs: {
    credentials: {
      crm: { type: "oauth2", authorizeUrl: "https://crm.test/authorize", tokenUrl: "https://crm.test/token", scopes: ["contacts"] },
      key: { type: "apiKey" },
    },
    state: true,
    actions: { notify: { input: { type: "object" }, output: { type: "object" } } },
  },
  config: { type: "object" },
};

const appMethods: Fixtures<AppMethods> = {
  initialize: [{ params: { protocolVersion: "1", platformUrl: "http://localhost:3000/rpc" }, result: { manifest } }],
  health: [{ params: {}, result: { status: "ok" } }],
  install: [{ params: { context, callbackToken: "payload.mac" }, result: {} }],
  uninstall: [{ params: { context, callbackToken: "payload.mac" }, result: {} }],
  "actions/invoke": [
    {
      params: { action: "upsert", input: { email: "a@b.test" }, context: callContext, callbackToken: "payload.mac" },
      result: { output: { id: 1 } },
    },
  ],
};

const levels: LogLevel[] = ["debug", "info", "warn", "error"];

const platformMethods: Fixtures<PlatformMethods> = {
  "credentials/get": [
    { params: { name: "crm" }, result: { type: "oauth2", accessToken: "at", expiresAt: "2026-10-28T12:00:00Z" } },
    { params: { name: "key" }, result: { type: "apiKey", key: "k" } },
  ],
  "state/get": [{ params: { key: "cursor" }, result: { value: 3 } }],
  "state/set": [{ params: { key: "cursor", value: 4 }, result: {} }],
  log: [
    { params: { level: "info", message: "synced", data: { count: 2 } }, result: {} },
    ...levels.map((level) => ({ params: { level, message: level }, result: {} })),
  ],
  "actions/invoke": [{ params: { port: "notify", input: {} }, result: { output: null } }],
};

const signedMethods: Fixtures<SignedPlatformMethods> = {
  "actions/start": [{ params: { installId: "i-1", action: "upsert", input: {} }, result: { output: {} } }],
  "apps/list": [
    {
      params: { installId: "i-1" },
      result: { apps: [{ appId: "a-1", name: "crm", description: "A CRM connector", actions: manifest.provides.actions ?? {} }] },
    },
  ],
  "ports/list": [
    {
      params: { installId: "i-1" },
      result: {
        ports: {
          notify: {
            appId: "a-2",
            name: "mailer",
            action: "send",
            credentials: { key: { type: "apiKey", connected: false }, crm: { type: "oauth2", connected: true } },
          },
          crm: null,
        },
      },
    },
  ],
  "ports/bind": [{ params: { installId: "i-1", port: "notify", appId: "a-2", action: "send" }, result: {} }],
  "ports/unbind": [{ params: { installId: "i-1", port: "notify" }, result: {} }],
  "ports/connect": [
    {
      params: { installId: "i-1", port: "notify", credential: "key", returnTo: "https://app.test/integrations" },
      result: { url: "https://crm.test/authorize?state=s" },
    },
  ],
};

const byFile = { "app-methods": appMethods, "platform-methods": { ...platformMethods, ...signedMethods } };

describe("protocol contract", () => {
  it("defines the same methods in the schemas and in types.ts", () => {
    const methodsOf = (name: string) =>
      Object.keys(files.find((file) => file.$id === idOf(name))?.$defs ?? {}).filter((key) => key !== "callbackToken");
    for (const [file, fixtures] of Object.entries(byFile)) expect(methodsOf(file).sort()).toEqual(Object.keys(fixtures).sort());
  });

  for (const [file, fixtures] of Object.entries(byFile)) {
    for (const [method, cases] of Object.entries(fixtures)) {
      it(`${file} ${method} matches its schema`, () => {
        for (const { params, result } of cases) {
          expect(valid(methodRef(file, method, "params"), params)).toBe(true);
          expect(valid(methodRef(file, method, "result"), result)).toBe(true);
        }
      });
    }
  }

  it("validates a full manifest and a trace member", () => {
    expect(valid(idOf("manifest"), manifest)).toBe(true);
    expect(valid(idOf("trace"), { traceparent: "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01" })).toBe(true);
  });

  it("rejects values the schemas forbid", () => {
    const { name: _name, ...nameless } = manifest;
    expect(valid(idOf("manifest"), nameless)).not.toBe(true);
    expect(valid(methodRef("platform-methods", "credentials/get", "params"), { name: "crm", tenantId: "acme" })).not.toBe(true);
    expect(valid(idOf("trace"), { traceparent: "not-a-traceparent" })).not.toBe(true);
  });
});
