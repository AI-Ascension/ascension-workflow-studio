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
  process.stderr.write("gateway stub ready stderr\r\n");
});
server.on("error", (error) => {
  process.stderr.write(`gateway stub failed: ${error.message}\n`);
  process.exit(1);
});
let stopping = false;
process.on("SIGTERM", () => {
  if (stopping) return;
  stopping = true;
  server.close();
  process.stdout.write(`gateway stub final stdout:\r\n${"G".repeat(65_536)}\n`, () => {
    process.stderr.write(`gateway stub final stderr:\r\n${"D".repeat(65_536)}\n`, () => process.exit(0));
  });
});
