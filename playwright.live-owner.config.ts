import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser", testMatch: "live-owner.spec.ts", reporter: "list",
  use: { baseURL: "http://127.0.0.1:4186", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], launchOptions: { args: ["--disable-dev-shm-usage"] } } }],
  webServer: { command: "node tools/live-owner-test-server.mjs", url: "http://127.0.0.1:4186", reuseExistingServer: false, timeout: 120000 },
});
