#!/usr/bin/env node
// Stub `sts2-harness-runtime serve-workflow` for the live-owner stack tests.
//
// The fixture resolves all four of its binaries through STUDIO_*_BINARY
// environment variables, so a test can drive the real fixture end to end
// without a Rust build. This stub answers only the two endpoints the
// fixture polls while bringing the stack to readiness; it makes no claim to
// implement the owner.
import { createServer } from "node:http";

const port = Number(process.env.STS2_WORKFLOW_LISTEN.split(":")[1]);
const token = process.env.STS2_WORKFLOW_TOKEN_STUDIO_LIVE;
const instanceId = process.env.STS2_INSTANCE_ID;

const server = createServer((request, response) => {
  if (request.headers.authorization !== `Bearer ${token}`) {
    response.writeHead(401);
    response.end("unauthorized");
    return;
  }
  if (request.url === "/v1/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end('{"ok":true}');
    return;
  }
  if (request.url === "/v1/workflow-targets") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ targets: [{ instance_id: instanceId }] }));
    return;
  }
  response.writeHead(404);
  response.end();
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`owner stub listening on ${port}\n`);
});
server.on("error", (error) => {
  process.stderr.write(`owner stub failed: ${error.message}\n`);
  process.exit(1);
});
process.on("SIGTERM", () => {
  server.close();
  process.exit(0);
});
