// Lint config for every TypeScript package. Each package runs `eslint` on its own sources through
// `turbo run lint`. Import boundaries between packages are checked by dependency-cruiser instead
// (`.dependency-cruiser.cjs`).
import js from "@eslint/js";
import tseslint from "typescript-eslint";

/** AGENTS.md says Effect first. Async code stays at framework and third-party boundaries. */
const noPromises = [
  { selector: ":function[async=true]", message: "Write an Effect, not an async function. Convert at the boundary." },
  { selector: "NewExpression[callee.name='Promise']", message: "Write an Effect, not a Promise. Convert at the boundary." },
  { selector: "MemberExpression[object.name='Promise']", message: "Write an Effect, not a Promise. Convert at the boundary." },
  { selector: "TSTypeReference[typeName.name='Promise']", message: "Return an Effect, not a Promise. Convert at the boundary." },
];

/**
 * Domain packages take branded IDs from @totem/ids, never plain strings. Covers parameters of every
 * function form (including defaulted and constructor parameter properties), variables, and fields
 * of type literals, interfaces and classes.
 */
const noStringIds = [
  {
    selector: "Identifier[name=/Id$/] > TSTypeAnnotation > TSStringKeyword",
    message: "Type an ID with its brand from @totem/ids.",
  },
  {
    selector: ":matches(TSPropertySignature, PropertyDefinition)[key.name=/Id$/] > TSTypeAnnotation > TSStringKeyword",
    message: "Type an ID field with its brand from @totem/ids.",
  },
];

const tests = ["**/*.test.ts", "**/test-network.ts"];

export default tseslint.config(
  { ignores: ["**/dist/**", "**/routeTree.gen.ts", "examples/hubspot/totem-test/**"] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    rules: {
      // A leading underscore marks a name as deliberately unused, for example a field dropped by a rest pattern.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", ignoreRestSiblings: true },
      ],
      "@typescript-eslint/switch-exhaustiveness-check": ["error", { considerDefaultExhaustiveForUnions: true }],
    },
  },
  {
    // Libraries and the platform log through Effect. Examples and scripts may print.
    files: ["protocol/src/**", "sdk/**/src/**", "platform/src/**", "packages/*/src/**"],
    ignores: ["platform/src/server.ts"],
    rules: { "no-console": "error" },
  },
  {
    // Domain packages are new code, so they take the strictest rules from the start.
    files: ["packages/*/src/**"],
    extends: [tseslint.configs.strictTypeChecked],
    rules: { "no-restricted-syntax": ["error", ...noPromises, ...noStringIds] },
  },
  {
    // Tests drive Promise-based tools such as vitest, so they keep only the ID rule.
    files: tests.map((glob) => `packages/*/src/${glob}`),
    rules: { "no-restricted-syntax": ["error", ...noStringIds] },
  },
  {
    // node.ts and server.ts adapt the platform to Node, so they may use Promises.
    files: ["platform/src/**"],
    ignores: [...tests, "platform/src/node.ts", "platform/src/server.ts"],
    rules: { "no-restricted-syntax": ["error", ...noPromises] },
  },
  {
    // A Sealed secret is read only where it is sent or used as a key.
    files: ["platform/src/**"],
    ignores: [
      ...tests,
      "platform/src/connections.ts",
      "platform/src/apps.ts",
      "platform/src/platform-methods.ts",
      "platform/src/callback-token.ts",
    ],
    rules: {
      "no-restricted-properties": [
        "error",
        { property: "reveal", message: "Read a Sealed secret only where it is sent or used as a key (see the allowlist above)." },
      ],
    },
  },
);
