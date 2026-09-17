import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { OwnerApiClient } from "../../packages/client/src";
import {
  ContextControlCommandSchema,
  ContextControlReceiptSchema,
  ContextOwnerAssociationSchema,
  ContextOwnerEffectiveLimitsSchema,
  type ContextControlCommand,
  type ContextControlReceipt,
} from "../../packages/contracts/src";

const OWNER_TOKEN = "studio-live-ci-token";
const POLICY_SCHEMA = "ascension.provider-session.policy.v1";

interface FixturePorts {
  STUDIO_LIVE_OWNER_PROXY_PORT: string;
  STUDIO_LIVE_OWNER_STACK_PORT: string;
}

interface ProductionFixture {
  run_id: string;
  request_id: string;
  instance_id: string;
  definition_digest: string;
  context_source_digest: string;
  context_source_document: Record<string, unknown>;
}

interface PolicyCommandResult {
  schema_version: string;
  operation: string;
  revision: number;
  policy_sha256: string | null;
  proposal_sha256: string | null;
  effect_class: string;
  inference_calls: number;
  game_effects: number;
}

interface RunSubmission {
  status: number;
  errorCode: string | null;
  run: Record<string, any>;
  transportRecovered?: boolean;
}

async function connectLiveOwner(page: Page, ownerProxy: string): Promise<void> {
  await page.goto("about:blank");
  await page.evaluate((url) => { window.location.assign(url); }, `${ownerProxy}/`);
  await page.waitForURL(`${ownerProxy}/`);
  await page.waitForLoadState("load");
  await page.waitForTimeout(250);
  await page.getByRole("button", { name: "Open settings" }).click();
  await page.getByLabel("Bearer token").fill(OWNER_TOKEN);
  await page.getByLabel("Authenticated actor subject").fill("profile:studio-live");
  await page.getByRole("button", { name: "Check owner connection" }).click();
  await expect(page.locator(".connection-message")).toContainText("Owner reports ok.");
  await page.getByRole("button", { name: /Live owner API/ }).click();
}

function servedDefinition(): Record<string, any> {
  const definition = JSON.parse(readFileSync(
    new URL("../../contracts/accepted/phase1/conformance/valid-strict.json", import.meta.url),
    "utf8",
  )) as Record<string, any>;
  definition.annotations.synthetic = false;
  definition.game_profile = "sts2-live-v1";
  definition.policy_ref = "policy.live.v1";
  definition.graphs[0].nodes[0].config.projection_ref = "fair-play.live.v1";
  definition.graphs[0].nodes[1].config.decision_profile_ref = "decision.live.v1";
  definition.graphs[0].nodes[1].config.context_ref = "context.live.v1";
  definition.capabilities.required[0] = "observe.fair-play.v1";
  return definition;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
}

function migrationPolicy(
  runId: string,
  version: number,
  epoch: number,
  maxCompletedTurns: number,
): Record<string, unknown> {
  return {
    schema: POLICY_SCHEMA,
    policy_id: "studio-production-migration",
    scope: {
      project_id: "served-policy-project",
      run_id: runId,
      episode_id: "episode-served-policy-gate",
      agent_id: "served-policy-agent",
    },
    version,
    mode: "fixture_only",
    continuity: "strict_reviewed",
    credential_realm_ref: "studio-fixture-realm",
    profile_sha256: createHash("sha256").update("codex-app-server-fixture-v1").digest("hex"),
    cross_scope_fork: false,
    reconnect_resumes_gameplay: false,
    compaction_generation_permission_required: true,
    max_completed_turns: maxCompletedTurns,
    history_ttl_seconds: 3600,
    automatic_transform_policy: "deny_and_fence",
    epoch,
  };
}

async function createAdmittedRun(page: Page, fixture: ProductionFixture): Promise<RunSubmission> {
  const definition = servedDefinition();
  const definitionDigest = createHash("sha256").update(canonicalJson(definition)).digest("hex");
  expect(definitionDigest).toBe(fixture.definition_digest);

  return page.evaluate(async ({ definition, definitionDigest, fixture, token }) => {
    const headers = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
    const catalogResponse = await fetch("/v1/workflow-targets", { headers });
    const catalog = await catalogResponse.json();
    if (!catalogResponse.ok || catalog.schema_version !== "ascension.workflow-targets/v1") {
      throw new Error(`production target catalog returned ${catalogResponse.status}`);
    }
    const descriptor = catalog.targets.find((entry: { instance_id: string }) => entry.instance_id === fixture.instance_id);
    if (!descriptor) throw new Error("the prebound production target is absent");
    const target = {
      instance_id: descriptor.instance_id,
      execution_profile: "live.workflow.v1",
      execution_mode: "live",
      workflow_revision: definition.version,
      compatibility_revision: descriptor.compatibility_revision,
      capability_revision: descriptor.capability_revision,
      game_profile: "sts2-live-v1",
      save_profile: null,
      inference_profile: null,
      context_capability: null,
      provider_capability: null,
    };
    const preflightResponse = await fetch("/v1/workflow-targets/preflight", {
      method: "POST",
      headers,
      body: JSON.stringify({
        schema_version: "ascension.workflow-admission/v1",
        request_id: fixture.request_id,
        workflow_definition_digest: definitionDigest,
        target,
      }),
    });
    const preflight = await preflightResponse.json();
    if (!preflightResponse.ok) {
      throw new Error(`production target preflight returned ${preflightResponse.status}`);
    }
    const body = JSON.stringify({
      schema_version: "ascension.management/v1",
      request_id: fixture.request_id,
      definition,
      artifact_id: null,
      instance_id: fixture.instance_id,
      profile: "live.workflow.v1",
      admission: preflight.admission,
    });
    let transportError = false;
    let submissionResponse: Response | undefined;
    try {
      submissionResponse = await fetch("/v1/workflow-runs", {
        method: "POST",
        headers,
        body,
      });
    } catch {
      // The served live submission can durably reserve the run before its
      // response transport closes. Recover that accepted state below.
      transportError = true;
    }
    if (!transportError && submissionResponse) {
      // A concrete non-2xx response is an authoritative refusal. Preserve
      // that status even if its body is empty, malformed, or unreadable;
      // durable recovery is only for a missing response or ambiguous success.
      if (!submissionResponse.ok) {
        let text = "";
        try {
          text = await submissionResponse.text();
        } catch {
          return {
            status: submissionResponse.status,
            errorCode: `submission_refused_${submissionResponse.status}`,
            run: {},
          };
        }
        if (text) {
          let run: any;
          try {
            run = JSON.parse(text);
          } catch {
            return {
              status: submissionResponse.status,
              errorCode: "malformed_submission_response",
              run: {},
            };
          }
          return {
            status: submissionResponse.status,
            errorCode: run?.error?.code ?? `submission_refused_${submissionResponse.status}`,
            run,
          };
        }
        return {
          status: submissionResponse.status,
          errorCode: `submission_refused_${submissionResponse.status}`,
          run: {},
        };
      }
      let text: string;
      try {
        text = await submissionResponse.text();
      } catch {
        // A response body read can fail after the server durably accepted the
        // run, so this remains a genuine transport ambiguity.
        transportError = true;
        text = "";
      }
      if (!transportError && text) {
        let run: any;
        try {
          run = JSON.parse(text);
        } catch {
          return {
            status: submissionResponse.status,
            errorCode: "malformed_submission_response",
            run: {},
          };
        }
        return {
          status: submissionResponse.status,
          errorCode: run?.error?.code ?? null,
          run,
        };
      }
      // A successful response with no body leaves admission ambiguous: recover
      // the durable run by identity and validate the recovered admission below.
    }
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const statusResponse = await fetch(
        `/v1/workflow-runs/${encodeURIComponent(fixture.run_id)}`,
        { headers },
      );
      if (statusResponse.ok) {
        const status = await statusResponse.json();
        const recovered = status.run;
        const admission = recovered?.admission;
        if (
          recovered?.workflow_run_id === fixture.run_id
          && recovered.definition_digest === definitionDigest
          && admission?.schema_version === "ascension.workflow-admission/v1"
          && admission.request_id === fixture.request_id
          && admission.workflow_definition_digest === definitionDigest
          && admission.target?.instance_id === fixture.instance_id
          && admission.target?.execution_profile === "live.workflow.v1"
          && admission.target?.execution_mode === "live"
        ) {
          return {
            status: 200,
            errorCode: null,
            run: recovered,
            transportRecovered: true,
          };
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error("workflow submission response and durable run recovery both failed");
  }, { definition, definitionDigest, fixture, token: OWNER_TOKEN });

}

async function readRun(page: Page, runId: string): Promise<Record<string, any>> {
  return page.evaluate(async ({ runId, token }) => {
    const response = await fetch(`/v1/workflow-runs/${encodeURIComponent(runId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error(`run status returned ${response.status}`);
    return response.json();
  }, { runId, token: OWNER_TOKEN });
}

async function stepRun(
  page: Page,
  runId: string,
  expectedRevision: number,
  commandId: string,
): Promise<{ status: number; body: Record<string, any> }> {
  return page.evaluate(async ({ runId, expectedRevision, commandId, token }) => {
    const response = await fetch(`/v1/workflow-runs/${encodeURIComponent(runId)}/commands`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        schema_version: "ascension.management/v1",
        command_id: commandId,
        run_id: runId,
        expected_revision: expectedRevision,
        actor_scope: "profile:studio-live",
        kind: "step",
        parameters: {},
      }),
    });
    return { status: response.status, body: await response.json() };
  }, { runId, expectedRevision, commandId, token: OWNER_TOKEN });
}

async function readEffects(page: Page, ownerStack: string): Promise<{
  dispatches: Array<{ operation_id: string | null; action_id: string | null }>;
  settlements: Array<{ operation_id: string }>;
}> {
  const response = await page.request.get(`${ownerStack}/effects`);
  expect(response.status()).toBe(200);
  return response.json();
}

async function exerciseContextOwner(page: Page, fixture: ProductionFixture): Promise<{
  command: ContextControlCommand;
  receipt: ContextControlReceipt;
}> {
  const result = await page.evaluate(async ({ fixture, token }) => {
    const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
    const json = async (response: Response): Promise<any> => ({ status: response.status, body: await response.json() });
    let statusResponse = await fetch(`/v1/workflow-runs/${encodeURIComponent(fixture.run_id)}`, { headers });
    let status = await statusResponse.json();
    if (status.run?.cursor?.node_id !== "decide") {
      const stepResponse = await fetch(`/v1/workflow-runs/${encodeURIComponent(fixture.run_id)}/commands`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          schema_version: "ascension.management/v1",
          command_id: "studio.context-owner.step",
          run_id: fixture.run_id,
          expected_revision: status.run.run_revision,
          actor_scope: "profile:studio-live",
          kind: "step",
          parameters: {},
        }),
      });
      if (!stepResponse.ok) {
        throw new Error(`context owner step returned ${stepResponse.status}: ${await stepResponse.text()}`);
      }
      statusResponse = await fetch(`/v1/workflow-runs/${encodeURIComponent(fixture.run_id)}`, { headers });
      status = await statusResponse.json();
    }
    if (status.run?.cursor?.node_id !== "decide") {
      throw new Error(`context owner run cursor is ${status.run?.cursor?.node_id ?? "missing"}, expected decide`);
    }
    const catalogResponse = await fetch("/v1/context-bindings", { headers });
    const catalog = await catalogResponse.json();
    if (!catalogResponse.ok) throw new Error(`context owner catalog returned ${catalogResponse.status}`);
    const descriptor = catalog.descriptors.find((candidate: any) =>
      candidate.context_ref === "context.live.v1" && candidate.node_kinds.includes("decide"));
    if (!descriptor) throw new Error("context owner catalog omitted the decide descriptor");

    const sourceDocument = fixture.context_source_document;
    const sourceResponse = await fetch(
      `/v1/workflow-runs/${encodeURIComponent(fixture.run_id)}/context-sources/strategy`,
      { method: "PUT", headers, body: JSON.stringify({
        schema_version: "ascension.context-owner.context-source-upload.v1",
        document: sourceDocument,
      }) },
    );
    if (!sourceResponse.ok) throw new Error(`context source publication returned ${sourceResponse.status}`);
    const bindingRequest = {
      workflow_run_id: fixture.run_id,
      definition_digest: status.run.definition_digest,
      instance_id: fixture.instance_id,
      graph_id: status.run.cursor.graph_id,
      node_id: status.run.cursor.node_id,
      node_execution_id: status.run.cursor.node_execution_id,
      node_kind: "decide",
      context_ref: descriptor.context_ref,
      binding_id: descriptor.binding_id,
      binding_version: descriptor.version,
      binding_digest: descriptor.digest,
    };
    const bindResponse = await fetch("/v1/context-bindings/bind", {
      method: "POST",
      headers,
      body: JSON.stringify(bindingRequest),
    });
    if (!bindResponse.ok) throw new Error(`context owner bind returned ${bindResponse.status}`);

    const associationResponse = await fetch(
      `/v1/workflow-runs/${encodeURIComponent(fixture.run_id)}/context-owner-association`,
      { headers },
    );
    const association = await associationResponse.json();
    if (!associationResponse.ok) throw new Error(`context owner association returned ${associationResponse.status}`);
    const limitsResponse = await fetch(
      `/v1/workflow-runs/${encodeURIComponent(fixture.run_id)}/context-owner-effective-limits`,
      { headers },
    );
    const limits = await limitsResponse.json();
    if (!limitsResponse.ok) throw new Error(`context owner limits returned ${limitsResponse.status}`);

    const sourceStatusResponse = await fetch(
      `/v1/workflow-runs/${encodeURIComponent(fixture.run_id)}/context-owner-source-status`,
      { headers },
    );
    const sourceStatus = await sourceStatusResponse.json();
    if (!sourceStatusResponse.ok) throw new Error(`context owner source status returned ${sourceStatusResponse.status}`);
    const command = {
      commit: {
        idempotency_key: "studio.context-owner.receipt",
        expected_control_version: sourceStatus.boundary.control_version,
        expected_revision_id: sourceStatus.active_revision_id,
        expected_boundary: sourceStatus.boundary,
        preview_manifest_digest: fixture.context_source_digest,
        approved_manifest_digest: fixture.context_source_digest,
      },
    };
    const adoptionResponse = await fetch(
      `/v1/workflow-runs/${encodeURIComponent(fixture.run_id)}/context-sources/strategy/adopt`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          schema_version: "ascension.context-owner.context-source-adoption.v1",
          idempotency_key: command.commit.idempotency_key,
          expected_control_version: command.commit.expected_control_version,
          expected_revision_id: command.commit.expected_revision_id,
          expected_boundary: command.commit.expected_boundary,
        }),
      },
    );
    const receipt = await adoptionResponse.json();
    if (!adoptionResponse.ok) throw new Error(`context source adoption returned ${adoptionResponse.status}`);
    return { association, limits, command, receipt, sourceStatus };
  }, { fixture, token: OWNER_TOKEN });

  const association = ContextOwnerAssociationSchema.parse(result.association);
  const limits = ContextOwnerEffectiveLimitsSchema.parse(result.limits);
  const command = ContextControlCommandSchema.parse(result.command);
  const receipt = ContextControlReceiptSchema.parse(result.receipt);
  expect(association.binding.owner_id).toBe("served-context-owner");
  expect(association.binding.workflow_run_id).toBe(fixture.run_id);
  expect(association.binding.grants).toEqual({
    metadata_read: true,
    content_read: true,
    edit: false,
    control: true,
  });
  expect(association.binding.continuity).toEqual({
    survives_controller_restart: true,
    receipt_recovery: true,
    provider_session_continuity: false,
  });
  expect(limits.binding_digest).toBe(association.binding.binding_digest);
  expect(limits.effective_limits.max_control_events).toBe(64);
  expect(receipt.idempotency_key).toBe("studio.context-owner.receipt");
  return { command, receipt };
}

async function readPolicyCommand(response: import("@playwright/test").Response, operation: string): Promise<PolicyCommandResult> {
  expect(response.status()).toBe(200);
  const body = await response.json() as PolicyCommandResult;
  expect(body).toMatchObject({
    schema_version: "ascension.provider-session.policy-owner-command.v1",
    operation,
    effect_class: "local_metadata_only",
    inference_calls: 0,
    game_effects: 0,
  });
  return body;
}

test("uses production served policy routes for import, approval, adoption, refresh, switch, and restart", async ({ page }, testInfo: TestInfo) => {
  const ports = testInfo.project.metadata.fixturePorts as FixturePorts;
  const ownerProxy = `http://127.0.0.1:${ports.STUDIO_LIVE_OWNER_PROXY_PORT}`;
  const ownerStack = `http://127.0.0.1:${ports.STUDIO_LIVE_OWNER_STACK_PORT}`;
  const fixtureResponse = await fetch(`${ownerStack}/fixture`);
  expect(fixtureResponse.status).toBe(200);
  const fixture = await fixtureResponse.json() as ProductionFixture;
  expect(fixture.request_id).toBe("served-policy-gate");

  await connectLiveOwner(page, ownerProxy);
  const submitted = await createAdmittedRun(page, fixture);
  if (submitted.status !== 200) {
    throw new Error(`production run admission failed: ${submitted.errorCode ?? "unknown error"}`);
  }
  expect(submitted.run.workflow_run_id).toBe(fixture.run_id);
  const runId = submitted.run.workflow_run_id as string;
  const contextEvidence = await exerciseContextOwner(page, fixture);

  const authChecks = await page.evaluate(async ({ runId, token }) => {
    const path = `/v1/workflow-runs/${encodeURIComponent(runId)}/provider-session-policy`;
    const missing = await fetch(path);
    const invalid = await fetch(path, { headers: { Authorization: "Bearer invalid-production-fixture-token" } });
    const commandPath = `${path}/import?expected_revision=3`;
    const deniedWrite = await fetch(commandPath, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    const invalidWrite = await fetch(commandPath, {
      method: "POST",
      headers: {
        Authorization: "Bearer invalid-production-fixture-token",
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    const current = await fetch(path, { headers: { Authorization: `Bearer ${token}` } });
    const value = await current.json();
    return {
      missing: missing.status,
      invalid: invalid.status,
      current: current.status,
      deniedWrite: deniedWrite.status,
      invalidWrite: invalidWrite.status,
      value,
    };
  }, { runId, token: OWNER_TOKEN });
  expect(authChecks.missing).toBe(401);
  expect(authChecks.invalid).toBe(401);
  expect(authChecks.current).toBe(200);
  expect(authChecks.deniedWrite).toBe(401);
  expect(authChecks.invalidWrite).toBe(401);
  expect(authChecks.value).toMatchObject({
    schema_version: "ascension.provider-session.policy-owner-view.v1",
    operation: "current",
    value: { run_id: runId, revision: 3, active: { policy_id: "studio-production-baseline" } },
    effect_class: "local_metadata_only",
    inference_calls: 0,
    game_effects: 0,
  });
  expect(JSON.stringify(authChecks.value)).not.toMatch(/policy_bytes|credential_realm_ref|profile_sha256/);
  await page.getByRole("button", { name: "Runs", exact: true }).click();
  const runInput = page.getByRole("textbox", { name: "Run ID" });
  await runInput.fill(runId);
  await page.getByRole("button", { name: "Inspect", exact: true }).click();
  const ownerPanel = page.getByRole("region", { name: "Current context owner association" });
  await expect(ownerPanel).toBeVisible();
  await expect(ownerPanel).toContainText("served-context-owner");
  await expect(ownerPanel).toContainText("control yes");
  await expect(ownerPanel).toContainText("edit no");
  await expect(ownerPanel).toContainText("receipt recovery advertised");
  await expect(ownerPanel).toContainText("64 control events");
  const panel = page.getByRole("region", { name: "Saved provider-session policy" });
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("studio-production-baseline");

  const sourceBytes = Buffer.from(JSON.stringify(migrationPolicy(runId, 1, 1, 1_024), null, 2));
  const targetBytes = Buffer.from(JSON.stringify(migrationPolicy(runId, 2, 2, 1), null, 2));
  const sourceSha = createHash("sha256").update(sourceBytes).digest("hex");
  const targetSha = createHash("sha256").update(targetBytes).digest("hex");

  await panel.getByLabel("Policy JSON file").setInputFiles({
    name: "migration-source.json",
    mimeType: "application/json",
    buffer: sourceBytes,
  });
  const importResponsePromise = page.waitForResponse((response) =>
    response.request().method() === "POST"
    && new URL(response.url()).pathname.endsWith("/provider-session-policy/import"));
  await panel.getByRole("button", { name: "Import policy" }).click();
  const importResult = await readPolicyCommand(await importResponsePromise, "import");
  expect(importResult.policy_sha256).toBe(sourceSha);
  await expect(panel.getByText(sourceSha)).toBeVisible();
  const duplicateImport = await page.evaluate(async ({ runId, token, bytes }) => {
    const response = await fetch(
      `/v1/workflow-runs/${encodeURIComponent(runId)}/provider-session-policy/import?expected_revision=3`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: bytes,
      },
    );
    return { status: response.status, value: await response.json() };
  }, { runId, token: OWNER_TOKEN, bytes: sourceBytes.toString("utf8") });
  expect(duplicateImport.status).toBe(200);
  expect(duplicateImport.value.revision).toBe(4);

  await panel.getByLabel("Source policy").selectOption(sourceSha);
  await panel.getByLabel("Proposal ID").fill("migration.studio.production");
  await panel.getByLabel("Target policy JSON").setInputFiles({
    name: "migration-target.json",
    mimeType: "application/json",
    buffer: targetBytes,
  });
  const proposalResponsePromise = page.waitForResponse((response) =>
    response.request().method() === "POST"
    && new URL(response.url()).pathname.endsWith("/proposals/migration.studio.production"));
  await panel.getByRole("button", { name: "Create proposal" }).click();
  const proposalResult = await readPolicyCommand(await proposalResponsePromise, "propose");
  expect(proposalResult.proposal_sha256).toMatch(/^[a-f0-9]{64}$/);
  const proposalSha = proposalResult.proposal_sha256 as string;
  await expect(panel.getByText(proposalSha)).toBeVisible();

  const approval = panel.getByRole("region", { name: "Migration approvals and adoption" });
  await approval.getByLabel("Approval reference for migration.studio.production").fill("approval.studio.production");
  const approvalResponsePromise = page.waitForResponse((response) =>
    response.request().method() === "POST"
    && new URL(response.url()).pathname.endsWith("/approve"));
  await approval.getByRole("button", { name: "Record approval" }).click();
  const approvalResult = await readPolicyCommand(await approvalResponsePromise, "approve");
  expect(approvalResult.revision).toBe(6);
  await expect(approval).toContainText("Approval recorded by owner.");

  await approval.getByLabel("Approval reference for migration.studio.production").fill("approval.studio.production");
  const adoptionResponsePromise = page.waitForResponse((response) =>
    response.request().method() === "POST"
    && new URL(response.url()).pathname.endsWith("/adopt"));
  await approval.getByRole("button", { name: "Adopt approved proposal" }).click();
  const adoptionResult = await readPolicyCommand(await adoptionResponsePromise, "adopt");
  expect(adoptionResult.revision).toBe(7);
  expect(adoptionResult.policy_sha256).toBe(targetSha);

  const staleBytes = Buffer.from(JSON.stringify(migrationPolicy(runId, 3, 3, 1_024), null, 2));
  const staleWrite = await page.evaluate(async ({ runId, token, bytes }) => {
    const response = await fetch(
      `/v1/workflow-runs/${encodeURIComponent(runId)}/provider-session-policy/import?expected_revision=6`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: bytes,
      },
    );
    const current = await fetch(`/v1/workflow-runs/${encodeURIComponent(runId)}/provider-session-policy`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return { status: response.status, current: await current.json() };
  }, { runId, token: OWNER_TOKEN, bytes: staleBytes.toString("utf8") });
  expect(staleWrite.status).toBe(409);
  expect(staleWrite.current.value.revision).toBe(7);

  await panel.getByRole("button", { name: "Refresh history" }).click();
  await expect(panel.getByRole("region", { name: "Current adopted policy" })).toContainText(targetSha);
  await expect(panel).toContainText("migration.studio.production");
  await expect(panel).toContainText("adopted");

  await runInput.fill("run.live.foreign-owner");
  await page.getByRole("button", { name: "Inspect", exact: true }).click();
  await expect(page.locator(".notice-danger strong")).toHaveText("Inspection error");
  await expect(panel).toHaveCount(0);
  await runInput.fill(runId);
  await page.getByRole("button", { name: "Inspect", exact: true }).click();
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("region", { name: "Current adopted policy" })).toContainText(targetSha);

  // The browser has authenticated against the real served workflow. The Mod and
  // provider peers are synthetic fixture processes; no native gameplay claim is
  // made by this acceptance journey. Inspect the decide-bound context owner
  // before advancing the cursor to execute, where that invocation-specific
  // binding is expected to become unavailable.
  let current = await readRun(page, runId);
  expect(current.run.cursor.node_id).toBe("decide");
  const decided = await stepRun(page, runId, current.run.run_revision, "studio.browser.ac3.decide");
  expect(decided.status).toBe(200);
  current = await readRun(page, runId);
  if (current.run.cursor.node_id !== "execute") {
    throw new Error(`decide command did not advance: ${JSON.stringify(decided.body)}`);
  }
  expect(current.run.cursor.node_id).toBe("execute");

  const dispatched = await stepRun(page, runId, current.run.run_revision, "studio.browser.ac3.dispatch");
  expect(dispatched.status).toBe(200);
  current = await readRun(page, runId);
  expect(current.run.status).toBe("needs_operator");
  expect(current.run.pending_operation?.state).toBe("unknown");
  const operationId = current.run.pending_operation.operation_id as string;
  const beforeReload = await readEffects(page, ownerStack);
  expect(beforeReload.dispatches).toHaveLength(1);
  expect(beforeReload.dispatches[0].operation_id).toBe(operationId);
  expect(beforeReload.dispatches[0].action_id).toBe("potion:7:potion:fire:enemy:1");

  const restartResponse = await fetch(`${ownerStack}/restart`, { method: "POST" });
  expect(restartResponse.status).toBe(200);
  const restartEvidence = await restartResponse.json();
  expect(restartEvidence).toMatchObject({
    restarted: true,
    durable_owner: {
      reopened: true,
      run_id: runId,
      revision: 7,
      history_count: 3,
      proposal_state: "adopted",
      active_policy_id: "studio-production-migration",
      effect_class: "local_metadata_only",
      inference_calls: 0,
      game_effects: 0,
    },
  });
  const typedOwnerClient = new OwnerApiClient({
    baseUrl: "/v1",
    token: OWNER_TOKEN,
    actorScope: "profile:studio-live",
    fetcher: (input, init) => fetch(new URL(String(input), ownerProxy), init),
  });
  const recoveredReceipt = await typedOwnerClient.lookupContextControlReceipt(
    runId,
    contextEvidence.command,
  );
  const recovered = await page.evaluate(async ({ runId, token }) => {
    const association = await fetch(
      `/v1/workflow-runs/${encodeURIComponent(runId)}/context-owner-association`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    return {
      associationStatus: association.status,
      association: await association.json(),
    };
  }, { runId, token: OWNER_TOKEN });
  expect(recoveredReceipt).toEqual(contextEvidence.receipt);
  expect(recovered.associationStatus).toBe(503);
  expect(recovered.association.error.code).toBe("context_owner_association_unavailable");
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(ownerPanel).toContainText("Current context owner association is unavailable");
  await panel.getByRole("button", { name: "Refresh history" }).click();
  await expect(panel.getByRole("region", { name: "Current adopted policy" })).toContainText(targetSha);
  await expect(panel).toContainText("migration.studio.production");

  const secondRestart = await fetch(`${ownerStack}/restart`, { method: "POST" });
  expect(secondRestart.status).toBe(200);
  await page.reload();
  await page.waitForLoadState("load");
  await connectLiveOwner(page, ownerProxy);

  const reloaded = await readRun(page, runId);
  expect(reloaded.run.pending_operation).toMatchObject({
    operation_id: operationId,
    state: "unknown",
  });
  await page.getByRole("button", { name: "Runs", exact: true }).click();
  await page.getByRole("textbox", { name: "Run ID" }).fill(runId);
  await page.getByRole("button", { name: "Inspect", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Run inspector" })).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Control plane state" }).locator("dl.detail-list"),
  ).toContainText(`${operationId} · unknown`);

  const reconciled = await stepRun(
    page,
    runId,
    reloaded.run.run_revision,
    "studio.browser.ac3.reconcile",
  );
  expect(reconciled.status).toBe(200);
  current = await readRun(page, runId);
  if (current.run.pending_operation) {
    const terminal = await stepRun(
      page,
      runId,
      current.run.run_revision,
      "studio.browser.ac3.terminal",
    );
    expect(terminal.status).toBe(200);
    current = await readRun(page, runId);
  }
  expect(current.run.status).toBe("completed");
  const afterReconcile = await readEffects(page, ownerStack);
  expect(afterReconcile.dispatches).toHaveLength(1);
  expect(afterReconcile.dispatches[0].operation_id).toBe(operationId);
  expect(afterReconcile.settlements.length).toBeGreaterThanOrEqual(1);
  expect(afterReconcile.settlements.every((entry) => entry.operation_id === operationId)).toBe(true);
});
