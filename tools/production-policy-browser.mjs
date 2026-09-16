import { spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const projectArgument = args.find((argument) => argument.startsWith("--project="));
const selectedProject = projectArgument?.slice("--project=".length);
const projectArgs = args.filter((argument) => !argument.startsWith("--project="));
const cleanupTest = spawnSync(process.execPath, [
  "--test", resolve(root, "tools/live-owner-production-stack.test.mjs"),
], {
  cwd: root,
  stdio: "inherit",
  env: process.env,
});
if (cleanupTest.status !== 0) process.exit(cleanupTest.status ?? 1);
await rm(resolve(root, "test-results"), { recursive: true, force: true });

const projects = selectedProject
  ? [selectedProject]
  : [
    "chromium-production-policy",
    "firefox-production-policy",
    "webkit-production-policy",
  ];
const names = [
  "STUDIO_LIVE_OWNER_PORT",
  "STUDIO_LIVE_GATEWAY_PORT",
  "STUDIO_LIVE_MOD_PORT",
  "STUDIO_LIVE_OWNER_STACK_PORT",
  "STUDIO_LIVE_OWNER_PROXY_PORT",
  "STUDIO_LIVE_OWNER_PREVIEW_PORT",
];
const playwrightCli = resolve(root, "node_modules/playwright/cli.js");
for (const project of projects) {
  const reserved = await reserveLoopbackPorts(names.length);
  const environment = { ...process.env };
  names.forEach((name, index) => { environment[name] = String(reserved[index]); });
  const browserRun = spawnSync(process.execPath, [
    playwrightCli,
    "test",
    "--config",
    "playwright.production-policy.config.ts",
    ...projectArgs,
    `--project=${project}`,
  ], { cwd: root, stdio: "inherit", env: environment });
  if (browserRun.status !== 0) process.exit(browserRun.status ?? 1);
}

async function reserveLoopbackPorts(count) {
  const reservations = [];
  try {
    for (let index = 0; index < count; index += 1) {
      const server = createServer();
      reservations.push(server);
      await new Promise((resolveListen, rejectListen) => {
        server.once("error", rejectListen);
        server.listen(0, "127.0.0.1", resolveListen);
      });
    }
    const ports = reservations.map((server) => {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("failed to reserve fixture port");
      return address.port;
    });
    await Promise.all(reservations.map((server) =>
      new Promise((resolveClose, rejectClose) =>
        server.close((error) => error ? rejectClose(error) : resolveClose()),
      ),
    ));
    return ports;
  } catch (error) {
    await Promise.all(reservations.map((server) =>
      new Promise((resolveClose) => {
        if (!server.listening) return resolveClose();
        server.close(() => resolveClose());
      }),
    ));
    throw error;
  }
}
