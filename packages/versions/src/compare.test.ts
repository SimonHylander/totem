import type { Manifest } from "@totem/protocol";
import { Result } from "effect";
import { describe, expect, it } from "vitest";
import { compare, requireCompatible, sameJson } from "./compare.js";

const signature = { input: { type: "object" }, output: { type: "object" } } as const;

const base: Manifest = {
  name: "crm",
  version: "1.0.0",
  protocol: "1",
  provides: { actions: { upsert: signature }, triggers: { created: { payload: { type: "object" } } } },
  needs: { credentials: { key: { type: "apiKey" } }, state: true, actions: { notify: signature } },
  config: { type: "object" },
};

/** `base` with `change` applied, and how compare classifies it. */
const cases: [string, (m: Manifest) => Manifest, ReturnType<typeof compare>][] = [
  ["no change", (m) => m, { _tag: "Patch" }],
  ["new version and description", (m) => ({ ...m, version: "1.0.1", description: "CRM" }), { _tag: "Patch" }],
  [
    "a new action and a new port",
    (m) => ({
      ...m,
      provides: { ...m.provides, actions: { ...m.provides.actions, remove: signature } },
      needs: { ...m.needs, actions: { ...m.needs.actions, mail: signature } },
    }),
    { _tag: "Additive", added: ["provides.actions.remove", "needs.actions.mail"] },
  ],
  ["a removed action", (m) => ({ ...m, provides: { ...m.provides, actions: {} } }), { _tag: "Breaking", removed: ["provides.actions.upsert"], changed: [] }],
  [
    "a changed action signature",
    (m) => ({ ...m, provides: { ...m.provides, actions: { upsert: { ...signature, output: { type: "string" } } } } }),
    { _tag: "Breaking", removed: [], changed: ["provides.actions.upsert"] },
  ],
  ["a removed trigger", (m) => ({ ...m, provides: { actions: m.provides.actions } }), { _tag: "Breaking", removed: ["provides.triggers.created"], changed: [] }],
  ["a removed port", (m) => ({ ...m, needs: { ...m.needs, actions: {} } }), { _tag: "Breaking", removed: ["needs.actions.notify"], changed: [] }],
  [
    "a new credential",
    (m) => ({ ...m, needs: { ...m.needs, credentials: { ...m.needs.credentials, other: { type: "apiKey" } } } }),
    { _tag: "Breaking", removed: [], changed: ["needs.credentials"] },
  ],
  ["state dropped", (m) => ({ ...m, needs: { ...m.needs, state: false } }), { _tag: "Breaking", removed: [], changed: ["needs.state"] }],
  ["a new config schema", (m) => ({ ...m, config: { type: "object", required: ["region"] } }), { _tag: "Breaking", removed: [], changed: ["config"] }],
];

describe("compare", () => {
  for (const [name, change, expected] of cases) {
    it(name, () => {
      expect(compare(base, change(base))).toEqual(expected);
    });
  }
});

describe("requireCompatible", () => {
  it("refuses a Breaking change and names what broke", () => {
    const result = requireCompatible(base, { ...base, version: "2.0.0", provides: { actions: {} } });
    expect(Result.isFailure(result) && result.failure.message).toBe(
      "version 2.0.0 removes or changes provides.actions.upsert, provides.triggers.created",
    );
  });
});

describe("sameJson", () => {
  it("ignores key order and compares arrays by position", () => {
    expect(sameJson({ a: 1, b: [1, 2] }, { b: [1, 2], a: 1 })).toBe(true);
    expect(sameJson({ a: [1, 2] }, { a: [2, 1] })).toBe(false);
    expect(sameJson({ a: 1 }, { a: 1, b: undefined })).toBe(false);
    expect(sameJson(JSON.parse('{"__proto__":{}}'), { text: { type: "string" } })).toBe(false);
  });
});
