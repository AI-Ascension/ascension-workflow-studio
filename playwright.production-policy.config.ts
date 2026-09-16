import { spawnSync } from "node:child_process";
import { defineConfig, devices } from "@playwright/test";

const reservePortsScript = `
  const net = require("node:net");
  (async () => {
    const servers = [];
    try {
      for (let index = 0; index < 6; index += 1) {
        const server = net.createServer();
        servers.push(server);
        await new Promise((resolve, reject) => {
          server.once("error", reject);
          server.listen(0, "127.0.0.1", resolve);
        });
      }
      const ports = servers.map((server) => server.address().port);
      await Promise.all(servers.map((server) => new Promise((resolve, reject) =>
        server.close((error) => error ? reject(error) : resolve()),
      )));
      process.stdout.write(JSON.stringify(ports));
    } catch (error) {
      await Promise.all(servers.map((server) => new Promise((resolve) => {
        if (!server.listening) return resolve();
        server.close(() => resolve());
      })));
      console.error(error.message);
      process.exitCode = 1;
    }
  })();
`;
const names = [
  "STUDIO_LIVE_OWNER_PORT",
  "STUDIO_LIVE_GATEWAY_PORT",
  "STUDIO_LIVE_MOD_PORT",
  "STUDIO_LIVE_OWNER_STACK_PORT",
  "STUDIO_LIVE_OWNER_PROXY_PORT",
  "STUDIO_LIVE_OWNER_PREVIEW_PORT",
];
const suppliedPorts = names.every((name) => process.env[name]);
const allocation = suppliedPorts
  ? undefined
  : spawnSync(process.execPath, ["-e", reservePortsScript], { encoding: "utf8" });
if (allocation && allocation.status !== 0) throw new Error("could not reserve private production fixture ports");
const values = suppliedPorts
  ? names.map((name) => Number(process.env[name]))
  : JSON.parse(allocation?.stdout ?? "[]") as number[];
if (values.length !== names.length || values.some((port) => !Number.isInteger(port) || port < 1 || port > 65535)) {
  throw new Error("production fixture ports are incomplete or invalid");
}
const [ownerPort, gatewayPort, modPort, controlPort, proxyPort, previewPort] = values;
const ports = Object.fromEntries(names.map((name, index) => [name, String(values[index])]));

export default defineConfig({
  testDir: "./tests/browser",
  testMatch: "live-owner-production.spec.ts",
  reporter: "list",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: `http://127.0.0.1:${proxyPort}`,
    trace: "off",
    screenshot: "off",
  },
  workers: 1,
  projects: [
    {
      name: "chromium-production-policy",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: { args: ["--disable-dev-shm-usage"] },
      },
    },
    {
      name: "firefox-production-policy",
      use: { ...devices["Desktop Firefox"] },
    },
    {
      name: "webkit-production-policy",
      use: { ...devices["Desktop Safari"] },
    },
  ],
  webServer: [
      {
        command: "node tools/live-owner-production-stack.mjs",
        url: `http://127.0.0.1:${controlPort}/ready`,
        reuseExistingServer: false,
        timeout: 180_000,
        gracefulShutdown: { signal: "SIGTERM", timeout: 15_000 },
        env: ports,
      },
    {
      command: "node tools/live-owner-test-server.mjs",
        url: `http://127.0.0.1:${proxyPort}`,
        reuseExistingServer: false,
        timeout: 120_000,
        gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
        env: ports,
    },
  ],
  metadata: { productionOwnerPort: ownerPort, fixturePorts: ports },
});
