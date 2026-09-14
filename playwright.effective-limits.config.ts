import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

export default defineConfig({
  ...base,
  testMatch: "effective-limits.spec.ts",
  use: { ...base.use, baseURL: "http://127.0.0.1:4189" },
  webServer: {
    command: "npx vite build --config vite.effective-limits.config.ts && npx vite preview --config vite.effective-limits.config.ts --host 127.0.0.1 --port 4189 --strictPort",
    url: "http://127.0.0.1:4189/tests/fixtures/effective-limits.html",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
