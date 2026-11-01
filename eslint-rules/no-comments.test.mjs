import { after, describe, it } from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RuleTester } from "eslint";
import tseslint from "typescript-eslint";
import { noComments } from "./no-comments.mjs";

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.afterAll = after;

const decisionsDir = mkdtempSync(join(tmpdir(), "decisions-"));
writeFileSync(join(decisionsDir, "0011-platform-access.md"), "");
after(() => rmSync(decisionsDir, { recursive: true }));

const options = [{ decisionsDir }];
const tester = new RuleTester({ languageOptions: { parser: tseslint.parser } });
const valid = (code) => ({ code, options });
const invalid = (code, messageId) => ({ code, options, errors: [{ messageId }] });

tester.run("no-comments", noComments, {
  valid: [
    valid("/** Says hello. */\nexport function hello() {}"),
    valid("/** A user. */\nexport type User = {\n  /** Shown in the UI. */\n  readonly name: string;\n};"),
    valid("export class Store extends Base<{\n  /** Keyed by state. */\n  readonly pending: number;\n}> {}"),
    valid("export const manifest = {\n  /** The display name. */\n  name: 'x',\n};"),
    valid("/** Access rules (ADR 0011). */\nexport const rules = 1;"),
    valid("// quirk: HubSpot rejects '+' in scopes, so spaces are sent as %20.\nconst a = 1;"),
    valid("const a = 1; /* quirk: Safari drops the header on redirects. */"),
    valid("// @ts-expect-error a forged install has no brand\nconst a: number = 'x';"),
    valid("// eslint-disable-next-line no-restricted-syntax -- the fetch handler servers call\nconst a = 1;"),
    valid("/// <reference types=\"vite/client\" />\nconst a = 1;"),
    valid("#!/usr/bin/env node\nconst a = 1;"),
  ],
  invalid: [
    invalid("// Explains the next line.\nconst a = 1;", "comment"),
    invalid("const a = 1; // trailing", "comment"),
    invalid("/* block */\nconst a = 1;", "comment"),
    invalid("/** Internal helper. */\nfunction helper() {}", "comment"),
    invalid("/** Internal type. */\ntype Hidden = { readonly a: string };", "comment"),
    invalid("export function f() {\n  /** Inside a body. */\n  const a = 1;\n  return a;\n}", "comment"),
    invalid("export function f() {\n  // step one\n  return 1;\n}", "comment"),
    invalid("// eslint-disable-next-line no-console\nconsole.log(1);", "comment"),
    invalid("// @ts-expect-error\nconst a: number = 'x';", "comment"),
    invalid("// eslint-disable-next-line rule-to-test/no-comments -- because\nconst a = 1;", "selfDisable"),
    invalid("/** Bound by ADR 0099. */\nexport const a = 1;", "unknownAdr"),
    invalid("// TODO: quirk: later\nconst a = 1;", "comment"),
  ],
});
