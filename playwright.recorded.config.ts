import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  testMatch: ["recorded.spec.ts", "studio.spec.ts"],
  workers: 1,
  timeout: 60_000,
  reporter: "list",
  use: { baseURL: "http://127.0.0.1:4181", ...devices["Desktop Chrome"], colorScheme: "dark", launchOptions: { args: ["--disable-dev-shm-usage"] } },
  projects: [{ name: "chromium" }],
  webServer: { command: "npm run build && npm run preview -- --host 127.0.0.1 --port 4181 --strictPort", url: "http://127.0.0.1:4181", reuseExistingServer: false, timeout: 120_000 },
});
