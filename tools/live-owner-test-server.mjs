import { createProxyHandler } from "./live-owner-proxy.mjs";
import http from "node:http";
import { appendFileSync, mkdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ownerPort = Number(process.env.STUDIO_LIVE_OWNER_PORT ?? "4185");
const proxyPort = Number(process.env.STUDIO_LIVE_OWNER_PROXY_PORT ?? "4186");
const previewPort = Number(process.env.STUDIO_LIVE_OWNER_PREVIEW_PORT ?? "4187");
const proxyLogDir = resolve(process.env.STUDIO_LIVE_PROXY_DIAGNOSTIC_DIR ?? join(root, "tmp"));
const proxyLogPath = join(proxyLogDir, "studio-live-proxy.log");
try {
  mkdirSync(proxyLogDir, { recursive: true, mode: 0o700 });
} catch {
  // Diagnostics are best effort: never refuse to proxy because a log cannot be written.
}
const viteCli = resolve(root, "node_modules/vite/bin/vite.js");
const preview = spawn(process.execPath, [
  viteCli, "preview", "--host", "127.0.0.1", "--port", String(previewPort),
], {
  cwd: root,
  detached: true,
  stdio: "ignore",
});
let proxyServer;
let shuttingDown = false;

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    void shutdown(signal).finally(() => {
      process.exitCode = signal === "SIGINT" ? 130 : 143;
      process.exit();
    });
  });
}
process.on("exit", emergencyCleanup);

preview.once("error", (error) => {
  console.error(`studio preview failed to start: ${error.message}`);
  process.exitCode = 1;
  void shutdown().finally(() => process.exit());
});

proxyServer = http.createServer(createProxyHandler({ ownerPort, previewPort, recordProxyDiagnostic }));
proxyServer.once("error", (error) => {
  console.error(`studio preview proxy failed to start: ${error.message}`);
  process.exitCode = 1;
  void shutdown().finally(() => process.exit());
});
preview.once("spawn", () => {
  if (shuttingDown) return;
  if (typeof process.send === "function") {
    try { process.send({ type: "preview-process", pid: preview.pid }); } catch {}
    process.once("message", (message) => {
      if (message?.type === "start-proxy" && !shuttingDown) proxyServer.listen(proxyPort, "127.0.0.1");
    });
    return;
  }
  proxyServer.listen(proxyPort, "127.0.0.1");
});

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  if (proxyServer?.listening) {
    const closed = new Promise((resolveClose) => proxyServer.close(resolveClose));
    proxyServer.closeAllConnections();
    await Promise.race([closed, new Promise((resolveTimeout) => setTimeout(resolveTimeout, 1_000))]);
  }
  if (Number.isInteger(preview.pid) && preview.pid > 1) {
    try { preview.kill("SIGTERM"); } catch {}
    await waitForPreview(2_000);
    try { process.kill(-preview.pid, "SIGKILL"); } catch {}
    await waitForPreview(500);
  }
}

function waitForPreview(timeoutMillis) {
  if (preview.exitCode !== null || preview.signalCode !== null) return Promise.resolve();
  return Promise.race([
    new Promise((resolveClose) => preview.once("close", resolveClose)),
    new Promise((resolveTimeout) => setTimeout(resolveTimeout, timeoutMillis)),
  ]);
}

function recordProxyDiagnostic(entry) {
  const line = `${JSON.stringify(entry)}\n`;
  try {
    appendFileSync(proxyLogPath, line, { mode: 0o600 });
  } catch {
    console.error(`studio live proxy diagnostic was not recorded: ${line.trim()}`);
  }
}

function emergencyCleanup() {
  if (Number.isInteger(preview.pid) && preview.pid > 1) {
    try { process.kill(-preview.pid, "SIGKILL"); } catch {}
  }
}
