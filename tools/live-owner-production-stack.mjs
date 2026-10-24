import { createServer } from "node:http";
import { connect as connectTcp } from "node:net";
import { chmod, writeFile } from "node:fs/promises";
import { rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  diagnosticDestination,
  preserveDiagnosticLogsSync,
} from "./live-owner-diagnostics.mjs";
import { createProcessLifecycle, childHasExited } from "./live-owner-process-lifecycle.mjs";
import { createStackFixture, removeFixtureDataAfterChildren } from "./live-owner-stack-fixture.mjs";
import { startSyntheticModServer } from "./live-owner-synthetic-mod.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixture = createStackFixture(root, diagnosticDestination);
const {
  harnessRoot, harnessBinary, gatewayBinary, targetDir, ownerPort, gatewayPort, modPort, controlPort,
  ownerToken, fixtureRecordPath, bridgePath, runtimeLogPath, gatewayLogPath, ownedChildrenPath,
  ownedChildrenReportPath, ownerOutputPath, ownerErrorPath, gatewayOutputPath, gatewayErrorPath,
  contextSourceDocument, contextSourceDigest, bootstrapFixture, verifyFixture,
  createServiceEnvironment, assertRuntimeFiles, writeBridge,
} = fixture;
const lifecycle = createProcessLifecycle({
  cwd: harnessRoot, ownedChildrenPath, ownedChildrenReportPath,
});
let fixtureServer;
let closing = false;
let serviceEnvironment;
let fixtureInfo;
let modServer;
let workflowService;
let shutdownPromise;
let shutdownFailed = false;
const effectLedger = { dispatches: [], settlements: [] };

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    void shutdown(signal).finally(() => {
      process.exitCode = shutdownFailed ? 1 : signal === "SIGINT" ? 130 : 143;
      process.exit();
    });
  });
}
process.on("exit", emergencyCleanup);

async function startFixtureStack() {
  await chmod(targetDir, 0o700);
  assertActive();
  await assertRuntimeFiles();
  assertActive();
  fixtureInfo = bootstrapFixture();
  await writeFile(fixtureRecordPath, JSON.stringify(fixtureInfo), { mode: 0o600 });
  await writeBridge();
  assertActive();
  serviceEnvironment = createServiceEnvironment(fixtureInfo);
  modServer = startSyntheticModServer(modPort, harnessRoot, effectLedger);
  assertActive();
  startGateway();
  await waitForPort(modPort);
  assertActive();
  await waitForPort(gatewayPort);
  assertActive();
  workflowService = startWorkflowService();
  await waitForWorkflowService();
  assertActive();
  lifecycle.setPhase("in_window", "fixture_running");
  fixtureServer = createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/ready") {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("ready");
      return;
    }
    if (request.method === "GET" && request.url === "/fixture") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        run_id: fixtureInfo.run_id,
        request_id: fixtureInfo.request_id,
        instance_id: fixtureInfo.instance_id,
        definition_digest: fixtureInfo.definition_digest,
        context_source_digest: contextSourceDigest,
        context_source_document: contextSourceDocument,
      }));
      return;
    }
    if (request.method === "GET" && request.url === "/effects") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(effectLedger));
      return;
    }
    if (request.method === "POST" && request.url === "/restart") {
      try {
        lifecycle.setPhase("in_window", "owner_restart");
        const stopped = await lifecycle.stopChild(workflowService, { phase: "in_window", reason: "owner_restart" });
        if (!stopped.ok) throw new Error("owner capture did not settle before restart");
        workflowService = undefined;
        const evidence = verifyFixture();
        workflowService = startWorkflowService();
        await waitForWorkflowService();
        lifecycle.setPhase("in_window", "fixture_running");
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ restarted: true, durable_owner: evidence }));
      } catch {
        response.writeHead(500, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "production owner restart verification failed" }));
      }
      return;
    }
    response.writeHead(404);
    response.end();
  });
  await new Promise((resolveListen, rejectListen) => {
    fixtureServer.once("error", rejectListen);
    fixtureServer.listen(controlPort, "127.0.0.1", resolveListen);
  });
}

startFixtureStack().catch(async (error) => {
  console.error(`production owner fixture failed: ${error instanceof Error ? error.message : "startup error"}`);
  await shutdown();
  process.exitCode = 1;
});

function assertActive() {
  if (closing) throw new Error("fixture stack is shutting down");
}

function startWorkflowService() {
  assertActive();
  return lifecycle.startChild(
    harnessBinary, ["serve-workflow"], serviceEnvironment, runtimeLogPath,
    { stdout: ownerOutputPath, stderr: ownerErrorPath },
  );
}

function startGateway() {
  assertActive();
  return lifecycle.startChild(gatewayBinary, [], {
    PATH: "/usr/bin:/bin",
    STS2_GATEWAY_ADDR: `127.0.0.1:${gatewayPort}`,
    STS2_MOD_ADDR: `127.0.0.1:${modPort}`,
    STS2_GATEWAY_TOKEN: "gateway-token",
    STS2_MOD_TOKEN: "mod-token",
    STS2_INSTANCE_ID: fixtureInfo.instance_id,
    STS2_CALLER_ID: "harness",
    STS2_SESSION_ID: "gateway-session-1",
    STS2_MCP_SESSION_ID: "mcp-session-1",
    STS2_LEASE_ID: "lease-1",
    STS2_LEASE_EPOCH: "1",
  }, gatewayLogPath, { stdout: gatewayOutputPath, stderr: gatewayErrorPath });
}

async function waitForWorkflowService() {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (!workflowService?.child || workflowService.spawnError || childHasExited(workflowService.child)) {
      throw new Error("serve-workflow exited before readiness; private logs remain in the fixture directory");
    }
    let health;
    try {
      health = await fetch(`http://127.0.0.1:${ownerPort}/v1/health`, {
        headers: { authorization: `Bearer ${ownerToken}` },
      });
    } catch {}
    if (health?.ok) {
      let targets;
      try {
        targets = await fetch(`http://127.0.0.1:${ownerPort}/v1/workflow-targets`, {
          headers: { authorization: `Bearer ${ownerToken}` },
        });
      } catch {}
      if (targets?.ok) {
        const catalog = await targets.json();
        if (!catalog.targets?.some((target) => target.instance_id === fixtureInfo.instance_id)) {
          throw new Error("workflow service responded without the fixture's expected target identity");
        }
        return;
      }
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error("serve-workflow readiness timed out; private logs remain in the fixture directory");
}

async function waitForPort(port) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const connected = await new Promise((resolveConnected) => {
      const socket = connectTcp({ host: "127.0.0.1", port });
      let settled = false;
      const settle = (value) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        resolveConnected(value);
      };
      socket.once("connect", () => settle(true));
      socket.once("error", () => settle(false));
      socket.setTimeout(500, () => settle(false));
    });
    if (connected) return;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error(`local fixture peer did not bind port ${port}`);
}

async function closeServer(server) {
  if (!server?.listening) return;
  const closed = new Promise((resolveClose) => server.close(resolveClose));
  server.closeAllConnections?.();
  await Promise.race([closed, new Promise((resolveTimeout) => setTimeout(resolveTimeout, 1_000))]);
}

function shutdown(signal) {
  if (shutdownPromise) return shutdownPromise;
  closing = true;
  lifecycle.setPhase("final_cleanup", signal ? "process_signal" : "fixture_shutdown");
  shutdownPromise = (async () => {
    await Promise.all([closeServer(fixtureServer), closeServer(modServer)]);
    const removed = await removeFixtureDataAfterChildren(targetDir, () => lifecycle.stopChildren({
      phase: "final_cleanup", reason: signal ? "process_signal" : "fixture_shutdown",
    }));
    if (!removed) { shutdownFailed = true; process.exitCode = 1; }
    if (signal) process.exitCode = signal === "SIGINT" ? 130 : 143;
  })();
  return shutdownPromise;
}

function emergencyCleanup() {
  lifecycle.emergencyCleanupSync();
  if (!lifecycle.canRemoveFixtureData()) return;
  preserveDiagnosticLogsSync(targetDir);
  try { rmSync(targetDir, { recursive: true, force: true }); } catch {}
}
