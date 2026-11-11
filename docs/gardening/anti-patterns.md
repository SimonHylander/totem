# Anti-patterns

Every known weed: how to detect it, its severity, and its replacement. Garden S1 first. Weed ids are stable, and a retired weed keeps its id.

- **S1, harmful:** causes bugs or security holes.
- **S2, spreading:** a second way to solve a problem that has a paved path.
- **S3, clutter:** dead code. Delete it.

Run detectors from the repo root. `.rgignore` keeps generated files and the HubSpot CLI project out of `rg`. Rule names refer to `eslint.config.mjs` unless they say otherwise.

### W1 `any`

- **Severity:** S1
- **Detect:** `rg -n ':\s*any\b|<any>|as any\b' -t ts .`
- **Rule:** `@typescript-eslint/no-explicit-any`, everywhere
- **Replace with:** inferred types. At a boundary, take `unknown` and follow paved path "Validation at I/O boundaries".

### W2 Type assertions with `as`

- **Severity:** S1
- **Detect:** `rg -nP '^(?!\s*(//|/?\*|import\b|export\s*(type\s*)?\{)).*[\w)\]>}"]\s+as\s+(?!const\b)(unknown|never|readonly|string|number|boolean|typeof|keyof|[A-Z{\[("])' -t ts .`
- **Rule:** unenforced. Candidate: `@typescript-eslint/consistent-type-assertions` with `assertionStyle: "never"`, baselined.
- **Replace with:** paved path "Validation at I/O boundaries" for parsed data. Elsewhere, a type guard or `satisfies`.

### W3 `@ts-ignore` and bare `@ts-expect-error`

- **Severity:** S1
- **Detect:** `rg -n '@ts-ignore|@ts-expect-error\s*$' -t ts .`
- **Rule:** `@typescript-eslint/ban-ts-comment`, everywhere
- **Replace with:** fix the type. A negative type test keeps `@ts-expect-error` with a description.

### W4 Swallowed errors

- **Severity:** S1
- **Detect:** `rg -nUP 'catch\s*(\([^)]*\))?\s*\{\s*\}|Effect\.(orDie|ignore)\b' -t ts .`. Also read `catch` blocks that only log or set a flag.
- **Rule:** `no-empty` for empty blocks. `orDie`, `ignore` and catch-and-log are unenforced.
- **Replace with:** paved path "Errors". `Effect.mapError(() => new X(...))` is fine when the cause must not leak, as in `platform/src/connections/connections.ts`.

### W5 Direct `process.env` reads

- **Severity:** S2
- **Detect:** `rg -n 'process\.env' -t ts .`
- **Rule:** unenforced until the config fork is decided. Candidate: `no-restricted-syntax` on `MemberExpression[object.name='process'][property.name='env']` outside the config module.
- **Replace with:** paved path "Configuration and environment variables"

### W6 Promises in Effect code

- **Severity:** S2
- **Detect:** `rg -nP '\basync\b|new Promise|\bPromise[.<]|\.then\(' packages/*/src platform/src -g '!*.test.ts' -g '!test-network.ts' -g '!node.ts' -g '!server.ts'`
- **Rule:** `no-restricted-syntax` with `noPromises`, on packages and the platform
- **Replace with:** paved path "Async code"

### W7 Plain `string` IDs

- **Severity:** S1
- **Detect:** `rg -nP '\b(?!clientId)\w+Id\??:\s*string\b' packages platform/src -g '!*.test.ts' -g '!test-network.ts'`. An OAuth `clientId` belongs to the provider, so it stays a `string`.
- **Rule:** `no-restricted-syntax` with `noStringIds`, on packages only. The platform is unenforced.
- **Replace with:** paved path "IDs". An ID with no brand yet, such as `bindingId`, gets one in `@totem/ids`.

### W8 `console` in library code

- **Severity:** S2
- **Detect:** `rg -n 'console\.' protocol/src sdk/javascript-sdk/src platform/src packages -g '!server.ts'`
- **Rule:** `no-console` on protocol, SDK, platform and packages
- **Replace with:** paved path "Logging and tracing"

### W9 Reading a `Sealed` secret outside the allowlist

- **Severity:** S1
- **Detect:** `rg -n '\.reveal\(' platform/src -g '!*.test.ts'`, then compare against the allowlist in `eslint.config.mjs`
- **Rule:** `no-restricted-properties` on `reveal`, in `platform/src`
- **Replace with:** paved path "Secrets"

### W10 Bare `new Error`

- **Severity:** S2
- **Detect:** `rg -n 'new Error\(' -t ts -g '!*.test.ts' -g '!test-network.ts' -g '!live.ts' -g '!**/scripts/**' .`
- **Rule:** unenforced
- **Replace with:** paved path "Errors". A missing env var follows "Configuration and environment variables". A missing form field follows "Validation at I/O boundaries".

### W11 Non-null assertions

- **Severity:** S1
- **Detect:** `rg -nP '[\w)\]]!(?=[.,;)\]\s])' -t ts -g '!*.test.ts' -g '!test-network.ts' .`
- **Rule:** `@typescript-eslint/no-non-null-assertion` through `strictTypeChecked`, on packages only
- **Replace with:** narrow with a check, or decode regex groups with a schema.

### W12 Hand-rolled object guards

- **Severity:** S2
- **Detect:** `rg -nP 'typeof \w+(\.\w+)? === "object"' -t ts -g '!*.test.ts' .`
- **Rule:** unenforced
- **Replace with:** paved path "Validation at I/O boundaries"

### W13 Unused exports

- **Severity:** S3
- **Detect:** `knip`, which is not installed. Exports in `protocol/src/types.ts` and package `index.ts` files are public API, not dead code.
- **Rule:** unenforced
- **Replace with:** delete
