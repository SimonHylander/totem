import { defineConfig } from "vitest/config";

// Tests cover the Totem app logic only, so they skip the TanStack Start plugin in vite.config.ts.
export default defineConfig({ test: { include: ["src/**/*.test.ts"] } });
