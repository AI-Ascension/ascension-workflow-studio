import { createServer } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { connect as connectTcp } from "node:net";
import { chmod, rm, stat, writeFile } from "node:fs/promises";
import {
  appendFileSync,
  chmodSync,
  createWriteStream,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  diagnosticDestination,
  preserveDiagnosticLogs,
  preserveDiagnosticLogsSync,
} from "./live-owner-diagnostics.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const harnessRoot = resolve(process.env.STUDIO_HARNESS_ROOT ?? join(root, "harness"));
const harnessBinary = resolve(process.env.STUDIO_HARNESS_RUNTIME_BINARY ?? join(harnessRoot, "target/debug/sts2-harness-runtime"));
const gatewayBinary = resolve(process.env.STUDIO_GATEWAY_BINARY ?? join(harnessRoot, "target/review220-pinned-peers/debug/sts2-gateway-runtime"));
const mcpBinary = resolve(process.env.STUDIO_MCP_BINARY ?? join(harnessRoot, "target/review220-pinned-peers/debug/sts2-mcp-server"));
const cargoTargetDir = resolve(process.env.STUDIO_PROVIDER_POLICY_CARGO_TARGET_DIR ?? join(root, "target/studio-provider-policy-cargo"));
const fixtureBinary = resolve(process.env.STUDIO_PROVIDER_POLICY_FIXTURE_BINARY ?? join(cargoTargetDir, "debug/studio-provider-policy-production-fixture"));
const fixtureRoot = resolve(process.env.STUDIO_LIVE_FIXTURE_ROOT ?? join(root, "target"));
mkdirSync(fixtureRoot, { recursive: true, mode: 0o700 });
const targetDir = mkdtempSync(join(fixtureRoot, "studio-live-policy-production-"));
chmodSync(targetDir, 0o700);
const ownerPort = Number(process.env.STUDIO_LIVE_OWNER_PORT ?? "4185");
const gatewayPort = Number(process.env.STUDIO_LIVE_GATEWAY_PORT ?? "4190");
const modPort = Number(process.env.STUDIO_LIVE_MOD_PORT ?? "4191");
const controlPort = Number(process.env.STUDIO_LIVE_OWNER_STACK_PORT ?? "4188");
const ownerToken = "studio-live-ci-token";
const providerKey = randomBytes(32).toString("hex");
const contextKey = randomBytes(32).toString("hex");
const definitionPath = join(root, "contracts/accepted/phase1/conformance/valid-strict.json");
const policyStorePath = join(targetDir, "provider-policy.sqlite3");
const contextStorePath = join(targetDir, "context-owner.sqlite3");
const workflowStorePath = join(targetDir, "workflow.sqlite3");
const executionStorePath = join(targetDir, "execution.sqlite3");
const sourcePolicyPath = join(targetDir, "migration-source.json");
const targetPolicyPath = join(targetDir, "migration-target.json");
const fixtureRecordPath = join(targetDir, "fixture.json");
const bridgePath = join(targetDir, "bounded-exo-bridge.sh");
const runtimeLogPath = join(targetDir, "serve-workflow.log");
const contextSourceBytes = Buffer.from("studio browser context source", "utf8");
const contextSourceItemDigest = createHash("sha256").update(contextSourceBytes).digest("hex");
const contextSourceDocument = {
  draft: {
    schema: "ascension.context-control.draft.v1",
    draft_id: "studio-browser-context",
    version: 1,
    base_revision_id: "context.revision.1",
    selected_items: [{
      item_id: "studio-browser-context",
      version: 1,
      sha256: contextSourceItemDigest,
    }],
    pinned_item_ids: [],
    notes: [],
    objective: null,
    author_ref: "studio-browser",
  },
  items: {
    "studio-browser-context:1": {
      reference: {
        item_id: "studio-browser-context",
        version: 1,
        sha256: contextSourceItemDigest,
      },
      kind: "strategy",
      bytes: [...contextSourceBytes],
      protected: false,
      expires_at: 4_000_000_000,
    },
  },
};
const contextSourceDigest = createHash("sha256").update(JSON.stringify(contextSourceDocument)).digest("hex");
const gatewayLogPath = join(targetDir, "gateway.log");
const ownedChildrenPath = join(targetDir, "owned-child-pids.json");
const ownedChildrenReportPath = join(targetDir, "owned-children-report.json");
// The owner's own stdout/stderr is the one source that can say what the owner
// decided to do about a request it abandoned (#227). `serve-workflow.log` lives
// inside `targetDir`, so on a teardown path that removes `targetDir` it is gone
// before anyone can read it. These files are created directly in the
// diagnostics root -- outside `targetDir` by construction, not by convention --
// and are appended to for the whole life of the process.
const ownerOutputPath = join(diagnosticDestination(targetDir), "owner-stdout.log");
const ownerErrorPath = join(diagnosticDestination(targetDir), "owner-stderr.log");
const gatewayOutputPath = join(diagnosticDestination(targetDir), "gateway-stdout.log");
const gatewayErrorPath = join(diagnosticDestination(targetDir), "gateway-stderr.log");
mkdirSync(diagnosticDestination(targetDir), { recursive: true, mode: 0o700 });
const children = new Map();
let fixtureServer;
let closing = false;
let serviceEnvironment;
let fixtureInfo;
let modServer;
let workflowService;
let shutdownPromise;
const effectLedger = {
  dispatches: [],
  settlements: [],
};

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    void shutdown(signal).finally(() => {
      process.exitCode = signal === "SIGINT" ? 130 : 143;
      process.exit();
    });
  });
}
process.on("exit", emergencyCleanup);

async function startFixtureStack() {
  await chmod(targetDir, 0o700);
  assertActive();
  await assertFile(harnessBinary, "sts2-harness-runtime");
  await assertFile(gatewayBinary, "sts2-gateway-runtime");
  await assertFile(mcpBinary, "sts2-mcp-server");
  await assertFile(fixtureBinary, "provider policy fixture helper");
  assertActive();

  fixtureInfo = bootstrapFixture();
  await writeFile(fixtureRecordPath, JSON.stringify(fixtureInfo), { mode: 0o600 });
  await writeFile(
    bridgePath,
    "#!/bin/sh\ncat >/dev/null\nprintf '%s\\n' '{\"decision\":\"action\",\"action_id\":\"potion:7:potion:fire:enemy:1\",\"rationale\":\"use the visible potion\"}'\n",
    { mode: 0o700 },
  );
  await chmod(bridgePath, 0o700);
  assertActive();

  serviceEnvironment = {
    PATH: "/usr/bin:/bin",
    STS2_WORKFLOW_LISTEN: `127.0.0.1:${ownerPort}`,
    STS2_WORKFLOW_STORE: workflowStorePath,
    STS2_WORKFLOW_AUTH_PROFILE: "studio-live",
    STS2_WORKFLOW_TOKEN_STUDIO_LIVE: ownerToken,
    STS2_WORKFLOW_PROVIDER_POLICY_CONFIG: JSON.stringify(fixtureInfo.provider_policy_config),
    STS2_SERVED_PROVIDER_POLICY_KEY: providerKey,
    STS2_WORKFLOW_CONTEXT_OWNER_CONFIG: JSON.stringify({
      schema_version: "ascension.workflow-context-owner-config.v1",
      store_path: contextStorePath,
      key_reference: "STS2_SERVED_CONTEXT_OWNER_KEY",
      owner_id: "served-context-owner",
      owner_version: "v1",
      context_ref: "context.live.v1",
      render_required: true,
      sources: [{ source_id: "strategy", version: 1, digest: contextSourceDigest }],
      limits: {
        max_items: 64,
        max_notes: 16,
        max_context_bytes: 131072,
        max_objective_bytes: 512,
        max_control_events: 64,
      },
    }),
    STS2_SERVED_CONTEXT_OWNER_KEY: contextKey,
    STS2_EXECUTION_STORE_PATH: executionStorePath,
    STS2_GATEWAY_ADDR: `127.0.0.1:${gatewayPort}`,
    STS2_GATEWAY_TOKEN: "gateway-token",
    STS2_MCP_BINARY: mcpBinary,
    STS2_RUNTIME_PROFILE: "runtime-v4-expert",
    STS2_INSTANCE_ID: fixtureInfo.instance_id,
    STS2_CALLER_ID: "harness",
    STS2_SESSION_ID: "gateway-session-1",
    STS2_MCP_SESSION_ID: "mcp-session-1",
    STS2_LEASE_ID: "lease-1",
    STS2_LEASE_EPOCH: "1",
    STS2_RUN_ID: fixtureInfo.run_id,
    STS2_EPISODE_ID: "episode-served-policy-gate",
    STS2_TRAJECTORY_ID: "trajectory-served-policy-gate",
    STS2_TRACE_ID: "trace-served-policy-gate",
    STS2_ARTIFACT_ID: "artifact-served-policy-gate",
    STS2_EXO_REVISION: "b06869ab789dee3f80ca474b5fa89dbe47ccb859",
    STS2_EXO_ADMISSION: "legacy",
    STS2_EXO_BRIDGE_BINARY: bridgePath,
    STS2_EXO_TIMEOUT_MILLIS: "2000",
    STS2_EXO_MAX_REQUEST_BYTES: "131072",
    STS2_EXO_MAX_RESPONSE_BYTES: "8192",
    STS2_OBJECTIVE: "exercise production-served saved policy routes",
  };

  modServer = startModServer(modPort);
  assertActive();
  startGateway();
  await waitForPort(modPort);
  assertActive();
  await waitForPort(gatewayPort);
  assertActive();
  workflowService = startWorkflowService();
  await waitForWorkflowService();
  assertActive();
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
        await stopChild(workflowService);
        workflowService = undefined;
        const evidence = verifyFixture();
        workflowService = startWorkflowService();
        await waitForWorkflowService();
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

async function assertFile(path, label) {
  try {
    if (!(await stat(path)).isFile()) throw new Error();
  } catch {
    throw new Error(`${label} binary is missing; set the matching STUDIO_*_BINARY environment variable`);
  }
}

function assertActive() {
  if (closing) throw new Error("fixture stack is shutting down");
}

function bootstrapFixture() {
  const result = spawnSync(fixtureBinary, [
    "bootstrap", policyStorePath, definitionPath, sourcePolicyPath, targetPolicyPath,
  ], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      STS2_SERVED_PROVIDER_POLICY_KEY: providerKey,
    },
    maxBuffer: 2 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`could not seed the production policy fixture: ${result.stderr.slice(-4000)}`);
  }
  const line = result.stdout.trim().split("\n").at(-1);
  if (!line) throw new Error("provider policy fixture helper returned no metadata");
  return JSON.parse(line);
}

function verifyFixture() {
  const result = spawnSync(fixtureBinary, [
    "verify", policyStorePath, definitionPath, targetPolicyPath,
  ], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      STS2_SERVED_PROVIDER_POLICY_KEY: providerKey,
    },
    maxBuffer: 2 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`reopened provider policy fixture did not validate: ${result.stderr.slice(-4000)}`);
  }
  const line = result.stdout.trim().split("\n").at(-1);
  if (!line) throw new Error("provider policy verifier returned no evidence");
  return JSON.parse(line);
}

function startWorkflowService() {
  // Marking each start makes a restart or an owner exit visible in the owner's
  // own captured output rather than something a reader has to infer from an
  // absence of bytes (#227).
  appendDiagnosticLine(
    ownerErrorPath,
    `== studio-live fixture: starting serve-workflow owner at ${new Date().toISOString()} ==`,
  );
  return startChild(
    harnessBinary,
    ["serve-workflow"],
    serviceEnvironment,
    runtimeLogPath,
    { stdout: ownerOutputPath, stderr: ownerErrorPath },
  );
}

function startGateway() {
  return startChild(gatewayBinary, [], {
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

// `capture` names the two files the child's own stdout and stderr are also
// teed into. They are required because the in-fixture `logPath` is destroyed by
// the same cleanup that runs on the failure path (#227): without a copy outside
// `targetDir`, everything the owner said about the request it abandoned is gone
// before anyone can read it.
function startChild(command, args, env, logPath, capture) {
  assertActive();
  const output = createWriteStream(logPath, { flags: "a", mode: 0o600 });
  const child = spawn(command, args, {
    cwd: harnessRoot,
    env,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  // The owner/gateway's own stdout and stderr are teed into files that live
  // outside `targetDir`, because #227's whole point is that the only component
  // that knows why the submission reset is the one whose output is otherwise
  // discarded. The in-fixture copy is kept so existing assertions and the
  // existing artifact keep working unchanged.
  const stdoutCapture = capture ? createDiagnosticCapture(capture.stdout) : undefined;
  const stderrCapture = capture ? createDiagnosticCapture(capture.stderr) : undefined;
  child.stdout.pipe(output, { end: false });
  child.stderr.pipe(output, { end: false });
  if (stdoutCapture) child.stdout.pipe(stdoutCapture, { end: false });
  if (stderrCapture) child.stderr.pipe(stderrCapture, { end: false });
  // `command`/`args` are captured here rather than read back off the
  // ChildProcess: `spawnfile` is an internal field, and the report must name the
  // owned process from data this function was actually given. Only the
  // executable and its argv are recorded -- never the environment, which
  // carries the provider and context keys.
  const entry = { child, output, logPath, command, args, spawnError: undefined };
  if (Number.isInteger(child.pid)) children.set(child.pid, entry);
  recordOwnedChildren();
  child.on("error", (error) => { entry.spawnError = error; recordOwnedChildren(); });
  child.on("close", (code, signal) => {
    // A child that stops answering is the observable fact #214 needs and that
    // the captured stdout/stderr logs cannot supply: both are empty for a
    // process that died mid-request, so the exit status is the only remaining
    // evidence of whether the owner crashed, was signalled, or exited cleanly.
    entry.exit = { code: code ?? null, signal: signal ?? null };
    recordOwnedChildren();
    output.end();
    // The marker goes through the same stream as the child's own output, and
    // `end()` is deferred until that stream flushes. `appendFileSync` here
    // would open the file independently and could land *before* output still
    // buffered in the stream, which would make the exit marker appear to
    // precede output the owner actually emitted last.
    appendDiagnosticLine(
      stderrCapture ? capture.stderr : undefined,
      `== studio-live fixture: child pid ${child.pid ?? "unknown"} exited code=${code ?? "null"} signal=${signal ?? "null"} ==`,
      stderrCapture,
    );
  });
  return entry;
}

// Opens a diagnostic file that cleanup cannot remove and never fails the
// fixture over: a capture path that cannot be opened simply disables the
// capture rather than refusing to run the browser gate.
function createDiagnosticCapture(path) {
  try {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    return createWriteStream(path, { flags: "a", mode: 0o600 });
  } catch {
    return undefined;
  }
}

// Appends one diagnostic line. With an open stream the marker is written
// through it so it keeps its place relative to buffered output; without one the
// file is appended directly, so a lifecycle marker still survives in the
// degraded case where the capture could not be opened.
function appendDiagnosticLine(path, line, stream) {
  if (!path) return;
  if (stream) {
    stream.end(`${line}\n`);
    return;
  }
  try {
    appendFileSync(path, `${line}\n`, { mode: 0o600 });
  } catch {}
}

// Records bounded process identity plus lifecycle for every owned child. The
// point of this file (#214) is to distinguish the three states that all look
// identical from an empty log: the owner exited non-zero, the owner was killed
// by a signal, or the owner stayed alive and the fault is elsewhere. The
// captured stdout/stderr logs cannot tell those apart, so the exit status is
// recorded next to them.
function recordOwnedChildren() {
  writeFileSync(ownedChildrenPath, JSON.stringify([...children.keys()]), { mode: 0o600 });
  writeFileSync(
    ownedChildrenReportPath,
    JSON.stringify([...children.entries()].map(([pid, entry]) => ({
      pid,
      command: entry.command,
      args: [...entry.args],
      spawn_error: entry.spawnError ? String(entry.spawnError.code ?? entry.spawnError.message) : null,
      exit: entry.exit ?? null,
    })), null, 2),
    { mode: 0o600 },
  );
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

function startModServer(port) {
  const goldenRoot = join(harnessRoot, "protocol-artifact");
  const normalObservation = JSON.parse(readFileSync(join(goldenRoot, "runtime-v3-gameplay/golden/state-response.json"), "utf8"));
  const expertObservation = JSON.parse(readFileSync(join(goldenRoot, "runtime-v4-expert/golden/observation.json"), "utf8"));
  const settledAction = JSON.parse(readFileSync(join(goldenRoot, "runtime-v4-expert-action/golden/action-settled.json"), "utf8"));
  return createServer(async (request, response) => {
    const chunks = [];
    let length = 0;
    for await (const chunk of request) {
      length += chunk.length;
      if (length > 131_072) {
        response.writeHead(413);
        response.end();
        return;
      }
      chunks.push(chunk);
    }
    if (request.headers.authorization !== "Bearer mod-token") {
      response.writeHead(401);
      response.end();
      return;
    }
    let body = {};
    if (chunks.length) {
      try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
      catch {
        response.writeHead(400);
        response.end();
        return;
      }
    }
    let status = 200;
    let value;
    const header = (name, fallback) => request.headers[name] ?? fallback;
    const identity = (operationId, generation, stateId, action) => ({
      correlation_id: header("x-sts2-correlation-id", "request"),
      instance_id: header("x-sts2-instance-id", body.instance_id ?? "instance-1"),
      session_id: header("x-sts2-session-id", body.session_id ?? "session-1"),
      lease_id: header("x-sts2-lease-id", body.lease_id ?? "lease-1"),
      lease_epoch: Number(header("x-sts2-lease-epoch", body.lease_epoch ?? 1)),
      generation,
      state_id: stateId,
      operation_id: operationId,
      action,
    });
    if (request.url === "/api/v3/runtime/state") {
      value = v3Response(normalObservation, "state_response", request.headers);
    } else if (request.url === "/api/v3/runtime/legal-actions") {
      value = v3Response(normalObservation, "legal_actions_response", request.headers);
    } else if (request.url === "/api/v4/runtime/expert-state") {
      value = { ...expertObservation, state_id: "live:7", generation: 7 };
    } else if (request.url === "/api/v4/runtime/expert-action") {
      const operationId = body.operation_id;
      effectLedger.dispatches.push({
        operation_id: operationId ?? null,
        action_id: body.action?.action_id ?? null,
      });
      value = {
        ...settledAction,
        ...identity(operationId, body.generation ?? 7, body.state_id ?? "live:7", body.action ?? null),
        status: "unknown",
        observation: null,
        transition: null,
        error_code: "transport_timeout",
      };
    } else if (request.url?.startsWith("/api/v4/runtime/expert-actions/")) {
      const operationId = request.url.slice("/api/v4/runtime/expert-actions/".length);
      effectLedger.settlements.push({
        operation_id: operationId,
      });
      value = {
        ...settledAction,
        ...identity(operationId, settledAction.generation, settledAction.state_id, settledAction.action),
        status: "settled",
      };
    } else {
      status = 404;
      value = { error_code: "fixture_route_missing" };
    }
    const encoded = JSON.stringify(value);
    response.writeHead(status, {
      "content-type": "application/json",
      "content-length": Buffer.byteLength(encoded),
      connection: "close",
    });
    response.end(encoded);
  }).listen(port, "127.0.0.1");
}

function v3Response(template, kind, headers) {
  const value = JSON.parse(JSON.stringify(template));
  value.kind = kind;
  value.correlation_id = headers["x-sts2-correlation-id"] ?? "";
  value.instance_id = "instance-1";
  value.session_id = "gateway-session-1";
  value.lease_id = "lease-1";
  value.lease_epoch = 1;
  value.generation = 7;
  value.state_id = "live:7";
  value.observation.state_id = "live:7";
  value.observation.generation = 7;
  value.observation.state = { state: "combat", turn_index: 8, enemies: [] };
  value.legal_actions = [{ action_id: "end:7", action: { kind: "end_turn" } }];
  if (kind === "legal_actions_response") value.observation = null;
  return value;
}

async function stopChild(entry) {
  if (!entry?.child) return;
  const child = entry.child;
  if (!Number.isInteger(child.pid)) {
    entry.output.end();
    return;
  }
  const exited = childHasExited(child);
  if (!exited) signalOwnedGroup(child.pid, "SIGTERM");
  await waitForChild(child, 3_000);
  // A child may leave workers in its private process group after exiting.
  signalOwnedGroup(child.pid, "SIGKILL");
  await waitForChild(child, 1_000);
  entry.output.end();
  // The entry is deliberately KEPT in `children` after teardown. Deleting it
  // here dropped the owner's terminal status from the report that CI actually
  // uploads: `recordOwnedChildren()` serialises whatever the map holds at the
  // instant it is last called, and the `close` handler that records `exit` for
  // the *other* child can fire after this one has already been removed. The
  // preserved report then held only the survivor -- and, worse, the owner that
  // was SIGKILLed mid-run was replaced in the artifact by the SIGTERM that this
  // routine shutdown sent it afterwards.
  //
  // Two CI artifacts from run 37185413888 reproduce exactly that: two children
  // are spawned, and each preserved `owned-children-report.json` holds one.
  // Retaining the entry makes the report a record of every process this fixture
  // owned, which is the property #214 needs to tell a crash from a signal from
  // a surviving owner.
  recordOwnedChildren();
}

function signalOwnedGroup(pid, signal) {
  if (!children.has(pid) || !Number.isInteger(pid) || pid <= 1) return;
  try { process.kill(-pid, signal); } catch {}
}

function waitForChild(child, timeoutMillis) {
  if (childHasExited(child)) return Promise.resolve();
  return Promise.race([
    new Promise((done) => child.once("close", done)),
    new Promise((done) => setTimeout(done, timeoutMillis)),
  ]);
}

function childHasExited(child) {
  return child.exitCode !== null || child.signalCode !== null;
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
  shutdownPromise = (async () => {
    await Promise.all([closeServer(fixtureServer), closeServer(modServer)]);
    await Promise.all([...children.values()].map(stopChild));
    // Preserve the gateway/runtime diagnostics BEFORE the recursive removal
    // below destroys them; without this the evidence for a
    // submission_refused_502 transport failure is gone before anyone reads it
    // (#214).
    await preserveDiagnosticLogs(targetDir);
    await rm(targetDir, { recursive: true, force: true }).catch(() => {});
    if (signal) process.exitCode = signal === "SIGINT" ? 130 : 143;
  })();
  return shutdownPromise;
}

function emergencyCleanup() {
  for (const { child } of children.values()) {
    if (!Number.isInteger(child.pid) || child.pid <= 1) continue;
    try { process.kill(-child.pid, "SIGKILL"); } catch {}
  }
  // Same preservation as the orderly path: this runs on process exit, where no
  // async work is possible, so the sync variant is used. Best-effort by
  // contract -- it never throws and never changes the exit code.
  preserveDiagnosticLogsSync(targetDir);
  try { rmSync(targetDir, { recursive: true, force: true }); } catch {}
}
