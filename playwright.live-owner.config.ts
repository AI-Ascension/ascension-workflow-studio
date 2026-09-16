import { defineConfig, devices } from "@playwright/test";
const proxyPort = process.env.STUDIO_LIVE_OWNER_PROXY_PORT ?? "4186";
export default defineConfig({
  testDir: "./tests/browser", testMatch: "live-owner.spec.ts", reporter: "list",
  use: { baseURL: `http://127.0.0.1:${proxyPort}`, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], launchOptions: { args: ["--disable-dev-shm-usage"] } } }],
  webServer: {
    command: "node tools/live-owner-test-server.mjs",
    url: `http://127.0.0.1:${proxyPort}`,
    reuseExistingServer: false,
    timeout: 120000,
    gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
  },
});
