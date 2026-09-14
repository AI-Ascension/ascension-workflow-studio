import { fileURLToPath } from "node:url";
import { defineConfig, mergeConfig } from "vite";
import base from "./vite.config";

export default mergeConfig(base, defineConfig({
  build: {
    outDir: "dist-effective-limits",
    rolldownOptions: {
      input: fileURLToPath(new URL("./tests/fixtures/effective-limits.html", import.meta.url)),
    },
  },
}));
