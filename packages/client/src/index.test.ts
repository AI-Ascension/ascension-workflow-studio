import { describe, expect, it } from "vitest";

import { contextBindingsFromOwnerCatalog, type EventPage, type RunEvent, type RunTargetConfiguration, type TargetDescriptor, type WorkflowDefinition } from "@studio/contracts";
import { semanticDigest } from "@studio/document";

import {
  CapabilityGateError,
  ClientError,
  ContextServiceClient,
  FixtureClient,
  OwnerApiClient,
  fixtureContextOwnerCatalog,
  applyEventPage,
  buildSafeCommand,
  createProjection,
  normalizeRelativeBase,
  parseSseDataChunk,
  validateTargetAdmissionBinding,
  validateTargetConfiguration,
} from "./index";

function event(sequence: number, runId = "run.fixture.1", digest = "digest"): RunEvent {
  return {
    schema_version: "ascension.workflow-event/v1",
    workflow_run_id: runId,
    sequence,
    run_revision: sequence,
    event_type: sequence === 1 ? "run_started" : "node_completed",
    definition_digest: digest,
    node_execution_id: `${runId}.node.${sequence}`,
    payload: { operation_id: null, classification: null, reason_code: "fixture" },
    integrity_digest: null,
  };
}

function page(events: RunEvent[], runId = "run.fixture.1"): EventPage {
  return {
    schema_version: "ascension.workflow-event/v1",
    workflow_run_id: runId,
    after_sequence: events[0] ? events[0].sequence - 1 : 0,
    oldest_sequence: events[0]?.sequence ?? null,
    newest_sequence: events.at(-1)?.sequence ?? null,
    next_after_sequence: events.at(-1)?.sequence ?? 0,
    gap: null,
    events,
  };
}

function workflowDefinition(): WorkflowDefinition {
  return {
    schema_version: "ascension.workflow/v1",
    workflow_id: "owner.workflow",
    version: "1.0.0",
    mode: "strict",
    game_profile: "synthetic",
    policy_ref: "policy.fixture",
    capabilities: { required: [], optional: [] },
    limits: { max_steps: 10, max_subworkflow_depth: 2, max_provider_calls: 2, max_parallel_analyses: 1, max_output_tokens: 128 },
    entry_graph: "main",
    graphs: [{ id: "main", entry_node: "start", nodes: [{ id: "start", kind: "observe", config: {} }], edges: [] }],
  };
}

describe("owner event projection", () => {
  it("applies contiguous events and ignores an exact duplicate", () => {
    const first = event(1);
    const second = event(2);
    const initial = createProjection("run.fixture.1", "digest");
    const applied = applyEventPage(initial, page([first, second]));
    expect(applied.kind).toBe("applied");
    if (applied.kind !== "applied") return;
    expect(applied.projection.lastSequence).toBe(2);
    const duplicate = applyEventPage(applied.projection, page([second]));
    expect(duplicate.kind).toBe("duplicate");
  });

  it("requires a resnapshot for gaps, foreign runs, and conflicting duplicates", () => {
    const initial = createProjection("run.fixture.1", "digest");
    const gap = applyEventPage(initial, page([event(2)]));
    expect(gap.kind).toBe("resnapshot");
    const foreign = applyEventPage(initial, page([event(1, "run.other")], "run.other"));
    expect(foreign.kind).toBe("resnapshot");
    const applied = applyEventPage(initial, page([event(1)]));
    if (applied.kind !== "applied") throw new Error("fixture did not apply");
    const conflicting = applyEventPage(applied.projection, page([{ ...event(1), payload: { ...event(1).payload, reason_code: "tampered" } }]));
    expect(conflicting.kind).toBe("resnapshot");
    const futurePage = applyEventPage(applied.projection, { ...page([event(2)]), after_sequence: 4 });
    expect(futurePage.kind).toBe("resnapshot");
    const schemaPage = applyEventPage(applied.projection, page([{ ...event(2), schema_version: "future/v2" }]));
    expect(schemaPage.kind).toBe("resnapshot");
  });

  it("parses framed SSE data and rejects unsafe command inputs", () => {
    expect(parseSseDataChunk("event: update\ndata: {\"sequence\":1}\n\ndata: {\"sequence\":2}\n\n")).toEqual([{ sequence: 1 }, { sequence: 2 }]);
    expect(buildSafeCommand("run.fixture.1", 3, "pause")).toEqual({ runId: "run.fixture.1", expectedRevision: 3, kind: "pause" });
    expect(() => buildSafeCommand("run/foreign", 3, "pause")).toThrow("qualified run ID");
    expect(() => parseSseDataChunk("data: {}\n\ndata: {}\n\n", 1)).toThrow("frame limit");
  });
});

describe("same-origin client boundary", () => {
  it("binds the platform fetch receiver for browser owner requests", async () => {
    const client = new OwnerApiClient({ fetcher: undefined });
    expect(client).toBeInstanceOf(OwnerApiClient);
  });
  it("accepts only relative API bases", () => {
    expect(normalizeRelativeBase("/v1/")).toBe("/v1");
    expect(() => normalizeRelativeBase("https://example.invalid/v1")).toThrow();
    expect(() => normalizeRelativeBase("//example.invalid/v1")).toThrow();
    expect(() => normalizeRelativeBase("/v1\\escape")).toThrow();
  });

  it("uses a relative URL and decodes owner responses at runtime", async () => {
    const requests: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      requests.push(String(input));
      return new Response(JSON.stringify({ schema_version: "ascension.management/v1", status: "ok" }), { status: 200, headers: { "content-type": "application/json" } });
    };
    const client = new OwnerApiClient({ baseUrl: "/v1", fetcher });
    await expect(client.health()).resolves.toEqual({ status: "ok", schema_version: "ascension.management/v1" });
    expect(requests).toEqual(["/v1/health"]);
  });

  it("rejects a successful HTTP response with an invalid owner shape", async () => {
    const fetcher: typeof fetch = async () => new Response(JSON.stringify({ status: "ok" }), { status: 200 });
    const client = new OwnerApiClient({ baseUrl: "/v1", fetcher });
    await expect(client.health()).rejects.toThrow("health failed runtime decoding");
  });

  it("maps the owner authoring routes into the Studio draft contract", async () => {
    const definition = workflowDefinition();
    const layout = { schemaVersion: "ascension.studio-layout/v1", semanticDigest: "pending", positions: {} };
    const draft = {
      schema_version: "ascension.studio-authoring/v1",
      draft_id: "draft.owner.workflow",
      definition_id: "owner.workflow",
      revision: 0,
      etag: "a".repeat(64),
      document: definition,
      layout,
      updated_at: "revision-0",
      conflict: null,
    };
    const requests: string[] = [];
    const fetcher: typeof fetch = async (input, init) => {
      requests.push(`${init?.method ?? "GET"} ${String(input)}`);
      const path = String(input);
      if (path.endsWith("/studio/definitions")) {
        return new Response(JSON.stringify({ schema_version: "ascension.studio-authoring/v1", definitions: [{ schema_version: "ascension.studio-authoring/v1", id: "published.owner", title: "Owner workflow", description: "Published", source: "published", version: "1.0.0", definition_digest: "b".repeat(64), definition, published_revision: 0 }] }), { status: 200 });
      }
      if (path.endsWith("/studio/drafts/draft.owner.workflow")) {
        if (init?.method === "PUT") {
          return new Response(JSON.stringify({ ...draft, revision: 1, etag: "c".repeat(64), updated_at: "revision-1" }), { status: 200 });
        }
        return new Response(JSON.stringify(draft), { status: 200 });
      }
      return new Response(JSON.stringify({ ...draft, revision: 1, etag: "c".repeat(64), updated_at: "revision-1" }), { status: 200 });
    };
    const client = new OwnerApiClient({ baseUrl: "/v1", fetcher });
    await expect(client.listDefinitions()).resolves.toHaveLength(1);
    await expect(client.getDraft("draft.owner.workflow")).resolves.toMatchObject({ revision: 0, layout });
    await expect(client.saveDraft({ draftId: draft.draft_id, definitionId: draft.definition_id, revision: 0, etag: draft.etag, document: definition, layout, clientMutationId: "mutation-1" })).resolves.toMatchObject({ revision: 1 });
    expect(requests).toEqual([
      "GET /v1/studio/definitions",
      "GET /v1/studio/drafts/draft.owner.workflow",
      "PUT /v1/studio/drafts/draft.owner.workflow",
    ]);
  });

  it("forwards the owner capability manifest during validation", async () => {
    const definition = workflowDefinition();
    let validationBody: Record<string, unknown> | undefined;
    const requests: string[] = [];
    const fetcher: typeof fetch = async (input, init) => {
      const path = String(input);
      requests.push(`${init?.method ?? "GET"} ${path}`);
      if (path.endsWith("/capabilities")) {
        return new Response(JSON.stringify({ schema_version: "ascension.capabilities/v1", capabilities: { capabilities: ["observe.fair-play.v1"] } }), { status: 200 });
      }
      validationBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ schema_version: "ascension.management/v1", valid: true, definition_digest: "a".repeat(64), diagnostics: [] }), { status: 200 });
    };
    const client = new OwnerApiClient({ baseUrl: "/v1", fetcher });
    await expect(client.validate(definition)).resolves.toMatchObject({ valid: true });
    expect(validationBody).toMatchObject({ capabilities: { capabilities: ["observe.fair-play.v1"] } });
    expect(requests).toEqual(["GET /v1/capabilities", "POST /v1/workflow-definitions/validate"]);
  });

  it("requires and forwards the authenticated subject for live commands", async () => {
    let commandBody: Record<string, unknown> | undefined;
    const fetcher: typeof fetch = async (_input, init) => {
      commandBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ schema_version: "ascension.management/v1", command_id: "command-1", workflow_run_id: "run.1", outcome: "accepted", run_revision: 1, sequence: null }), { status: 200 });
    };
    const client = new OwnerApiClient({ baseUrl: "/v1", fetcher });
    await expect(client.command("run.1", 1, "pause")).rejects.toMatchObject({ code: "actor_scope_required" });
    client.setActorScope("profile:studio");
    await client.command("run.1", 1, "pause", "command.stable");
    expect(commandBody).toMatchObject({ actor_scope: "profile:studio", command_id: "command.stable" });
  });

  it("decodes a scoped context association and rejects inferred unavailable identities", async () => {
    const digest = "a".repeat(64);
    const association = {
      schema_version: "ascension.workflow-context-association/v1",
      workflow: { workflow_run_id: "run.fixture.1", definition_digest: digest, graph_id: "main", node_id: "decide", node_execution_id: "run.fixture.1.node.2" },
      context: { availability: "unavailable", context_ref: null, run_id: null, episode_id: null, agent_id: null, snapshot_id: null, approved_revision_id: null, plan_epoch: null, reason_code: "adapter_unavailable" },
      capture: { mode: "unavailable", state: "unavailable", attempt_id: null, reason_code: "adapter_unavailable" },
      capabilities: { inspect_metadata: true, read_retained_content: false, edit_context: false, control_context: false, memory_search: false, provider_session_inspect: false },
    };
    const malformed = { ...association, context: { ...association.context, context_ref: "invented.context" } };
    const requests: string[] = [];
    const client = new OwnerApiClient({ baseUrl: "/v1", fetcher: async (input) => {
      requests.push(String(input));
      return new Response(JSON.stringify(requests.length === 1 ? association : malformed), { status: 200 });
    } });
    await expect(client.contextAssociation("run.fixture.1")).resolves.toMatchObject({ workflow: { node_execution_id: "run.fixture.1.node.2" } });
    expect(requests).toEqual(["/v1/workflow-runs/run.fixture.1/context"]);
    await expect(client.contextAssociation("run.fixture.1")).rejects.toThrow("workflow context association failed runtime decoding");
  });

  it("uses the Harness-owned, scoped provider-session projection", async () => {
    const requests: string[] = [];
    const client = new OwnerApiClient({ baseUrl: "/v1", fetcher: async (input) => {
      requests.push(String(input));
      return new Response(JSON.stringify({
        schema: "ascension.provider-session.api-result.v1", operation: "list",
        value: { run_id: "workflow.run.1", bindings: [], operations: [], next_cursor: null },
        effect_class: "local_metadata_only", inference_calls: 0, game_effects: 0,
      }), { status: 200 });
    } });
    await expect(client.providerSessions("workflow.run.1")).resolves.toMatchObject({ value: { run_id: "workflow.run.1" } });
    expect(requests).toEqual(["/v1/workflow-runs/workflow.run.1/provider-sessions"]);
  });

  it("uses typed, separate same-origin context read routes", async () => {
    const paths: string[] = [];
    let call = 0;
    const client = new ContextServiceClient({ baseUrl: "/api/context", fetcher: async (input) => {
      const path = String(input);
      paths.push(path);
      call += 1;
      if (call === 1) {
        return new Response(JSON.stringify({
          schema: "ascension.context-memory.capabilities.v1", product_phase: 3,
          scope: { project_id: "project", run_id: "run.1", episode_id: "episode", agent_id: "agent" },
          enabled: false, supported_operations: [], phase2_approval_required: true,
          persistent_provider_sessions: false, provider_side_compaction: false,
          hidden_reasoning_access: false, direct_game_dispatch: false,
        }), { status: 200 });
      }
      return new Response(JSON.stringify({
        run_id: "run.1", next_cursor: null,
        snapshots: [{ snapshot_id: "snapshot.1", run_id: "run.1", episode_id: "episode.1", boundary: "exo_session_request", capture_mode: "metadata", component_count: 2, application_capture_complete: true, incomplete_reasons: [] }],
      }), { status: 200 });
    } });
    await expect(client.memoryCapabilities()).resolves.toMatchObject({ enabled: false });
    await expect(client.snapshots("run.1")).resolves.toMatchObject({ snapshots: [{ snapshot_id: "snapshot.1" }] });
    expect(paths).toEqual(["/api/context/v3/memory/capabilities", "/api/context/v1/runs/run.1/snapshots"]);
  });

  it("uses a bounded Context comparison route rather than a generic proxy", async () => {
    const paths: string[] = [];
    const client = new ContextServiceClient({ baseUrl: "/api/context", fetcher: async (input) => {
      paths.push(String(input));
      return new Response(JSON.stringify({
        comparison: { left_snapshot_id: "snapshot.left", right_snapshot_id: "snapshot.right", same_boundary: false, same_component_order: true, changed_components: ["component.1"] },
        read_only: true,
      }), { status: 200 });
    } });
    await expect(client.compareSnapshots("context.run.1", "snapshot.left", "snapshot.right")).resolves.toMatchObject({ read_only: true });
    expect(paths).toEqual(["/api/context/v1/runs/context.run.1/compare?left=snapshot.left&right=snapshot.right"]);
  });

  it("decodes only bounded Context manifest metadata and paged event metadata", async () => {
    const paths: string[] = [];
    const client = new ContextServiceClient({ baseUrl: "/api/context", fetcher: async (input) => {
      const path = String(input);
      paths.push(path);
      if (path.includes("/snapshots/")) return new Response(JSON.stringify({
        schema: "ascension.context-snapshot.v1", snapshot_id: "snapshot.1",
        identity: { run_id: "context.run.1", episode_id: "episode.1", agent_id: "agent.1", model_execution_id: "execution.1", provider_attempt_id: "attempt.1" },
        boundary: "adapter.http_body", capture_mode: "metadata", application_capture_complete: true, incomplete_reasons: [],
        components: [{ component_id: "component.1", ordinal: 0, kind: "serialized_http_body", role: null, media_type: "application/json", observed_bytes: 12, content_status: "complete", content_ref: "must-not-reach-ui" }],
      }), { status: 200 });
      return new Response(JSON.stringify({ run_id: "context.run.1", events: [{ event_id: "event.1", producer_id: "producer.1", sequence: 1, snapshot_id: "snapshot.1", provider_attempt_id: "attempt.1", observed_at: "2026-09-12T00:00:00Z", event_type: "capture.prepared", details: { private: "discarded" } }], next_cursor: "cursor.1", gap: false, offline: false }), { status: 200 });
    } });
    const snapshot = await client.snapshot("context.run.1", "snapshot.1");
    expect(snapshot.components[0]).not.toHaveProperty("content_ref");
    const events = await client.events("context.run.1", "cursor.0");
    expect(events.events[0]).not.toHaveProperty("details");
    expect(paths).toEqual(["/api/context/v1/runs/context.run.1/snapshots/snapshot.1", "/api/context/v1/runs/context.run.1/events?cursor=cursor.0"]);
  });
});

function targetConfiguration(descriptor: TargetDescriptor, definition: WorkflowDefinition): RunTargetConfiguration {
  return {
    instance_id: descriptor.instance_id,
    execution_profile: descriptor.execution_profiles[0],
    execution_mode: descriptor.execution_mode,
    workflow_revision: definition.version,
    compatibility_revision: descriptor.compatibility_revision,
    capability_revision: descriptor.capability_revision,
    game_profile: descriptor.game_profiles[0],
    save_profile: descriptor.save_profiles[0] ?? null,
    inference_profile: descriptor.inference_profiles[0] ?? null,
    context_capability: null,
    provider_capability: null,
  };
}

function definitionFor(descriptor: TargetDescriptor): WorkflowDefinition {
  return {
    ...workflowDefinition(),
    game_profile: descriptor.game_profiles[0],
  };
}

async function admissionRequest(
  client: FixtureClient,
  descriptor: TargetDescriptor,
  definition: WorkflowDefinition,
  requestId: string,
) {
  return client.preflightTarget({
    schema_version: "ascension.workflow-admission/v1",
    request_id: requestId,
    workflow_definition_digest: await semanticDigest(definition),
    target: targetConfiguration(descriptor, definition),
  });
}

describe("target admission consumption", () => {
  it("publishes two distinct synthetic descriptors and never silently chooses one", async () => {
    const client = new FixtureClient([]);
    const catalog = await client.listTargets();
    expect(catalog.targets.map((target) => target.instance_id)).toEqual(["studio-inspection", "studio-inspection-secondary"]);
    expect(catalog.targets[0].execution_profiles).not.toEqual(catalog.targets[1].execution_profiles);
    expect(catalog.targets[0].compatibility_revision).not.toEqual(catalog.targets[1].compatibility_revision);
    expect(catalog.targets[0].game_profiles).toEqual(catalog.targets[1].game_profiles);
  });

  it("binds preflight to the exact selected configuration and rejects a substitute target", async () => {
    const client = new FixtureClient([]);
    const catalog = await client.listTargets();
    const [primary, secondary] = catalog.targets;
    const definition = definitionFor(primary);
    const preflight = await admissionRequest(client, primary, definition, "studio.run.1");
    expect(preflight.admission.target).toEqual(targetConfiguration(primary, definition));

    const accepted = await client.submitRun(definition, primary.instance_id, primary.execution_profiles[0], {
      requestId: "studio.run.1",
      admission: preflight.admission,
      target: targetConfiguration(primary, definition),
    });
    expect(accepted.workflow_run_id).toMatch(/^run\.fixture\./);

    const secondaryDefinition = definitionFor(secondary);
    await expect(client.submitRun(secondaryDefinition, secondary.instance_id, secondary.execution_profiles[0], {
      requestId: "studio.run.1",
      admission: preflight.admission,
      target: targetConfiguration(secondary, secondaryDefinition),
    })).rejects.toMatchObject({ code: "target_binding_mismatch" });
  });

  it("requires an owner admission before any fixture submission", async () => {
    const client = new FixtureClient([]);
    const catalog = await client.listTargets();
    const definition = definitionFor(catalog.targets[0]);
    await expect(client.submitRun(definition, catalog.targets[0].instance_id, catalog.targets[0].execution_profiles[0]))
      .rejects.toMatchObject({ code: "target_admission_required" });
    await expect(client.submitRun(definition, catalog.targets[0].instance_id, catalog.targets[0].execution_profiles[0]))
      .rejects.toBeInstanceOf(CapabilityGateError);
  });

  it("rejects an admission whose exact binding drifted after preflight", async () => {
    const client = new FixtureClient([]);
    const catalog = await client.listTargets();
    const descriptor = catalog.targets[0];
    const definition = definitionFor(descriptor);
    const preflight = await admissionRequest(client, descriptor, definition, "studio.run.drift");
    const drifted = { ...preflight.admission, target: { ...preflight.admission.target, execution_profile: "drifted.profile" } };
    await expect(client.submitRun(definition, descriptor.instance_id, descriptor.execution_profiles[0], {
      requestId: "studio.run.drift",
      admission: drifted,
      target: targetConfiguration(descriptor, definition),
    })).rejects.toBeInstanceOf(ClientError);
  });

  it("rejects a request id already bound to a different configuration", async () => {
    const client = new FixtureClient([]);
    const catalog = await client.listTargets();
    const definition = definitionFor(catalog.targets[0]);
    await admissionRequest(client, catalog.targets[0], definition, "studio.run.reuse");
    await expect(client.preflightTarget({
      schema_version: "ascension.workflow-admission/v1",
      request_id: "studio.run.reuse",
      workflow_definition_digest: await semanticDigest(definition),
      target: targetConfiguration(catalog.targets[1], definition),
    })).rejects.toMatchObject({ code: "target_request_conflict" });
  });

  it("deduplicates an exact retry and returns the original run identity", async () => {
    const client = new FixtureClient([]);
    const catalog = await client.listTargets();
    const descriptor = catalog.targets[0];
    const definition = definitionFor(descriptor);
    const preflight = await admissionRequest(client, descriptor, definition, "studio.run.retry");
    const options = {
      requestId: "studio.run.retry",
      admission: preflight.admission,
      target: targetConfiguration(descriptor, definition),
    };
    const first = await client.submitRun(definition, descriptor.instance_id, descriptor.execution_profiles[0], options);
    const second = await client.submitRun(definition, descriptor.instance_id, descriptor.execution_profiles[0], options);
    expect(second.workflow_run_id).toBe(first.workflow_run_id);
  });

  it("validates every binding field locally and fails closed on drift", () => {
    const descriptor: TargetDescriptor = {
      instance_id: "instance.local",
      execution_profiles: ["live.workflow.v1"],
      execution_mode: "live",
      compatibility_revision: "compat.v1",
      capability_revision: "cap.v1",
      availability: "available",
      supported_operations: ["workflow:live"],
      capabilities: ["context.control.v1"],
      game_profiles: ["sts2-live-v1"],
      save_profiles: [],
      inference_profiles: [],
    };
    const definition = { ...workflowDefinition(), game_profile: "sts2-live-v1" };
    const configuration = targetConfiguration(descriptor, definition);
    expect(() => validateTargetConfiguration(descriptor, configuration)).not.toThrow();
    expect(() => validateTargetConfiguration(descriptor, { ...configuration, game_profile: "wrong" })).toThrow(/game_profile/);
    expect(() => validateTargetConfiguration({ ...descriptor, availability: "revoked" }, configuration)).toThrow(/revoked/);
    expect(() => validateTargetConfiguration({ ...descriptor, supported_operations: [] }, configuration)).toThrow(/workflow:live/);

    const request = {
      schema_version: "ascension.workflow-admission/v1" as const,
      request_id: "studio.run.check",
      workflow_definition_digest: "a".repeat(64),
      target: configuration,
    };
    const admission = { ...request, descriptor_digest: "b".repeat(64), catalog_revision: "catalog.v1" };
    expect(() => validateTargetAdmissionBinding(admission, request)).not.toThrow();
    expect(() => validateTargetAdmissionBinding({ ...admission, request_id: "other" }, request)).toThrow(/request_id/);
    expect(() => validateTargetAdmissionBinding({ ...admission, target: { ...admission.target, instance_id: "other" } }, request)).toThrow(/instance_id/);
  });
});

describe("owner context binding catalog", () => {
  it("derives owner-validated bindings only from available metadata descriptors", async () => {
    const catalog = await fixtureContextOwnerCatalog();
    const bindings = contextBindingsFromOwnerCatalog(catalog);
    expect(bindings?.length).toBe(10);
    expect(bindings?.some((binding) => binding.context_ref === "context.synthetic.v1")).toBe(true);
    const denied = { ...catalog, descriptors: catalog.descriptors.map((descriptor) => ({ ...descriptor, state: "denied" as const })) };
    expect(contextBindingsFromOwnerCatalog(denied)).toEqual([]);
    expect(contextBindingsFromOwnerCatalog(undefined)).toBeUndefined();
  });

  it("lists fixture owner context bindings", async () => {
    const client = new FixtureClient([]);
    const catalog = await client.listContextBindings();
    expect(catalog.descriptors.length).toBe(10);
    expect(catalog.descriptors.some((descriptor) => descriptor.context_ref === "sts2.combat.context.v1")).toBe(true);
  });

  it("decodes the owner context-binding route", async () => {
    const catalog = await fixtureContextOwnerCatalog();
    const fetcher: typeof fetch = async (input) => {
      expect(String(input)).toContain("/v1/context-bindings");
      return new Response(JSON.stringify(catalog), { status: 200, headers: { "content-type": "application/json" } });
    };
    const client = new OwnerApiClient({ baseUrl: "/v1", fetcher });
    const decoded = await client.listContextBindings();
    expect(decoded.descriptors.length).toBe(10);
  });
});
