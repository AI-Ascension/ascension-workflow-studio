import { createHash, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync } from "node:fs";
import { chmod, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { preserveDiagnosticLogs } from "./live-owner-diagnostics.mjs";

export async function removeFixtureData(targetDir) {
  await preserveDiagnosticLogs(targetDir);
  await rm(targetDir, { recursive: true, force: true }).catch(() => {});
}

export async function removeFixtureDataAfterChildren(targetDir, stopChildren) {
  const outcome = await stopChildren();
  if (!outcome?.settled || !outcome.ok) return false;
  await removeFixtureData(targetDir);
  return true;
}

export function createStackFixture(root, diagnosticDestination) {
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
      selected_items: [{ item_id: "studio-browser-context", version: 1, sha256: contextSourceItemDigest }],
      pinned_item_ids: [], notes: [], objective: null, author_ref: "studio-browser",
    },
    items: {
      "studio-browser-context:1": {
        reference: { item_id: "studio-browser-context", version: 1, sha256: contextSourceItemDigest },
        kind: "strategy", bytes: [...contextSourceBytes], protected: false, expires_at: 4_000_000_000,
      },
    },
  };
  const contextSourceDigest = createHash("sha256").update(JSON.stringify(contextSourceDocument)).digest("hex");
  const gatewayLogPath = join(targetDir, "gateway.log");
  const ownedChildrenPath = join(targetDir, "owned-child-pids.json");
  const ownedChildrenReportPath = join(targetDir, "owned-children-report.json");
  const diagnosticsPath = diagnosticDestination(targetDir);
  const ownerOutputPath = join(diagnosticsPath, "owner-stdout.log");
  const ownerErrorPath = join(diagnosticsPath, "owner-stderr.log");
  const gatewayOutputPath = join(diagnosticsPath, "gateway-stdout.log");
  const gatewayErrorPath = join(diagnosticsPath, "gateway-stderr.log");
  mkdirSync(diagnosticsPath, { recursive: true, mode: 0o700 });

  function bootstrapFixture() {
    return runFixtureCommand("bootstrap", [sourcePolicyPath, targetPolicyPath]);
  }

  function verifyFixture() {
    return runFixtureCommand("verify", [targetPolicyPath]);
  }

  function runFixtureCommand(operation, paths) {
    const args = [operation, policyStorePath, definitionPath, ...paths];
    const result = spawnSync(fixtureBinary, args, {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, STS2_SERVED_PROVIDER_POLICY_KEY: providerKey },
      maxBuffer: 2 * 1024 * 1024,
    });
    if (result.status !== 0) {
      const message = operation === "bootstrap"
        ? "could not seed the production policy fixture"
        : "reopened provider policy fixture did not validate";
      throw new Error(`${message}: ${result.stderr.slice(-4000)}`);
    }
    const line = result.stdout.trim().split("\n").at(-1);
    if (!line) {
      throw new Error(operation === "bootstrap"
        ? "provider policy fixture helper returned no metadata"
        : "provider policy verifier returned no evidence");
    }
    return JSON.parse(line);
  }

  function createServiceEnvironment(fixtureInfo) {
    return {
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
        limits: { max_items: 64, max_notes: 16, max_context_bytes: 131072, max_objective_bytes: 512, max_control_events: 64 },
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
  }

  async function assertRuntimeFiles() {
    for (const [path, label] of [
      [harnessBinary, "sts2-harness-runtime"], [gatewayBinary, "sts2-gateway-runtime"],
      [mcpBinary, "sts2-mcp-server"], [fixtureBinary, "provider policy fixture helper"],
    ]) {
      try {
        if (!(await stat(path)).isFile()) throw new Error();
      } catch {
        throw new Error(`${label} binary is missing; set the matching STUDIO_*_BINARY environment variable`);
      }
    }
  }

  async function writeBridge() {
    await writeFile(
      bridgePath,
      "#!/bin/sh\ncat >/dev/null\nprintf '%s\\n' '{\"decision\":\"action\",\"action_id\":\"potion:7:potion:fire:enemy:1\",\"rationale\":\"use the visible potion\"}'\n",
      { mode: 0o700 },
    );
    await chmod(bridgePath, 0o700);
  }

  return {
    root, harnessRoot, harnessBinary, gatewayBinary, mcpBinary, fixtureBinary, fixtureRoot, targetDir,
    ownerPort, gatewayPort, modPort, controlPort, ownerToken, definitionPath, policyStorePath,
    contextStorePath, workflowStorePath, executionStorePath, fixtureRecordPath, bridgePath, runtimeLogPath,
    gatewayLogPath, ownedChildrenPath, ownedChildrenReportPath, ownerOutputPath, ownerErrorPath,
    gatewayOutputPath, gatewayErrorPath, contextSourceDocument, contextSourceDigest,
    bootstrapFixture, verifyFixture, createServiceEnvironment, assertRuntimeFiles, writeBridge,
  };
}
