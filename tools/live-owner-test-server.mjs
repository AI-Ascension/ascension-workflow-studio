import http from "node:http";
import { spawn } from "node:child_process";
const preview = spawn("npm", ["run", "preview", "--", "--host", "127.0.0.1", "--port", "4187"], { stdio: "inherit" });
const server = http.createServer((req, res) => {
  const target = req.url?.startsWith("/v1/") ? 4185 : 4187;
  const proxy = http.request({ host: "127.0.0.1", port: target, path: req.url, method: req.method, headers: req.headers }, upstream => { res.writeHead(upstream.statusCode ?? 502, upstream.headers); upstream.pipe(res); });
  proxy.on("error", () => { if (!res.headersSent) res.writeHead(502); res.end(); });
  req.pipe(proxy);
});
server.listen(4186, "127.0.0.1");
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { server.close(); preview.kill(signal); });
