import { fileURLToPath, URL } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@studio/contracts": fileURLToPath(new URL("./packages/contracts/src/index.ts", import.meta.url)),
      "@studio/document": fileURLToPath(new URL("./packages/document/src/index.ts", import.meta.url)),
      "@studio/client": fileURLToPath(new URL("./packages/client/src/index.ts", import.meta.url)),
    },
  },
  build: {
    sourcemap: false,
    target: "es2022",
  },
  server: {
    host: "127.0.0.1",
    port: 4173,
  },
});
