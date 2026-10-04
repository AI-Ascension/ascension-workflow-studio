#!/usr/bin/env node
// Stub `sts2-gateway-runtime`: bind the gateway port and idle. The stack only
// requires the listener to exist before it reports readiness.
import { createServer } from "node:net";

const port = Number(process.env.STS2_GATEWAY_ADDR.split(":")[1]);
const server = createServer((socket) => {
  socket.on("error", () => {});
  socket.on("data", () => {});
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`gateway stub listening on ${port}\n`);
});
server.on("error", (error) => {
  process.stderr.write(`gateway stub failed: ${error.message}\n`);
  process.exit(1);
});
process.on("SIGTERM", () => process.exit(0));
