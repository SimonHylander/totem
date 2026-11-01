import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// tanstackStart must come before the React plugin.
export default defineConfig({
  plugins: [tanstackStart({ srcDirectory: "src" }), viteReact()],
});
