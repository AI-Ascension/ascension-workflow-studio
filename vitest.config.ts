import { fileURLToPath, URL } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@studio/contracts": fileURLToPath(new URL("./packages/contracts/src/index.ts", import.meta.url)),
      "@studio/document": fileURLToPath(new URL("./packages/document/src/index.ts", import.meta.url)),
      "@studio/client": fileURLToPath(new URL("./packages/client/src/index.ts", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./apps/studio/src/test/setup.ts"],
    include: ["packages/**/*.test.ts", "apps/studio/src/**/*.test.tsx"],
  },
});
