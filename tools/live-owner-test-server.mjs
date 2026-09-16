import http from "node:http";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ownerPort = Number(process.env.STUDIO_LIVE_OWNER_PORT ?? "4185");
const proxyPort = Number(process.env.STUDIO_LIVE_OWNER_PROXY_PORT ?? "4186");
const previewPort = Number(process.env.STUDIO_LIVE_OWNER_PREVIEW_PORT ?? "4187");
const viteCli = resolve(root, "node_modules/vite/bin/vite.js");
const preview = spawn(process.execPath, [
  viteCli, "preview", "--host", "127.0.0.1", "--port", String(previewPort),
], {
  cwd: root,
  detached: true,
  stdio: "inherit",
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

proxyServer = http.createServer((req, res) => {
  const target = req.url?.startsWith("/v1/") ? ownerPort : previewPort;
  const { origin: _browserOrigin, ...forwardedHeaders } = req.headers;
  const headers = { ...forwardedHeaders, host: `127.0.0.1:${target}` };
  const proxy = http.request({
    host: "127.0.0.1",
    port: target,
    path: req.url,
    method: req.method,
    headers,
  }, (upstream) => {
    res.writeHead(upstream.statusCode ?? 502, upstream.headers);
    upstream.pipe(res);
  });
  proxy.on("error", () => {
    if (!res.headersSent) res.writeHead(502);
    res.end();
  });
  req.pipe(proxy);
});
proxyServer.listen(proxyPort, "127.0.0.1");
proxyServer.once("error", (error) => {
  console.error(`studio preview proxy failed to start: ${error.message}`);
  process.exitCode = 1;
  void shutdown().finally(() => process.exit());
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
    try { process.kill(-preview.pid, "SIGTERM"); } catch {}
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

function emergencyCleanup() {
  if (Number.isInteger(preview.pid) && preview.pid > 1) {
    try { process.kill(-preview.pid, "SIGKILL"); } catch {}
  }
}
