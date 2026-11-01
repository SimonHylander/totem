import { defineConfig } from "vite-plus";

// Root config for `vp lint` (Oxlint) and `vp fmt` (Oxfmt) across the workspace.
// examples/hubspot/totem-test is a HubSpot CLI project with its own dependencies and ESLint setup.
const ignorePatterns = ["**/dist/**", "examples/hubspot/totem-test/**"];

export default defineConfig({
  lint: {
    ignorePatterns,
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {
    ignorePatterns,
  },
});
