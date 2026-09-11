import http from "node:http";
import { spawn } from "node:child_process";
const ownerPort = Number(process.env.STUDIO_LIVE_OWNER_PORT ?? "4185");
const proxyPort = Number(process.env.STUDIO_LIVE_OWNER_PROXY_PORT ?? "4186");
const previewPort = Number(process.env.STUDIO_LIVE_OWNER_PREVIEW_PORT ?? "4187");
const preview = spawn("npm", ["run", "preview", "--", "--host", "127.0.0.1", "--port", String(previewPort)], { stdio: "inherit" });
const server = http.createServer((req, res) => {
  const target = req.url?.startsWith("/v1/") ? ownerPort : previewPort;
  const { origin: _browserOrigin, ...forwardedHeaders } = req.headers;
  const headers = { ...forwardedHeaders, host: `127.0.0.1:${target}` };
  const proxy = http.request({ host: "127.0.0.1", port: target, path: req.url, method: req.method, headers }, upstream => { res.writeHead(upstream.statusCode ?? 502, upstream.headers); upstream.pipe(res); });
  proxy.on("error", () => { if (!res.headersSent) res.writeHead(502); res.end(); });
  req.pipe(proxy);
});
server.listen(proxyPort, "127.0.0.1");
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { server.close(); preview.kill(signal); });
