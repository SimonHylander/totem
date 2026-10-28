// Lint config for every TypeScript package. Each package runs `eslint` on its own sources through `turbo run lint`.
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/routeTree.gen.ts", "examples/hubspot/totem-test/**"] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    rules: {
      // A leading underscore marks a name as deliberately unused, for example a field dropped by a rest pattern.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", ignoreRestSiblings: true },
      ],
    },
  },
);
