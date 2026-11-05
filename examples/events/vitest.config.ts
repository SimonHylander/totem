import { defineConfig } from "vitest/config";

// Tests skip the TanStack Start plugin in vite.config.ts, so they never run a server function.
export default defineConfig({ test: { include: ["src/**/*.test.ts"] } });
