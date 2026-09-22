import {
  ContextAssociationSchema,
  DefinitionRecordSchema,
  DraftRecordSchema,
  ProviderSessionListSchema,
  RunTargetConfigurationSchema,
  TargetAdmissionBindingSchema,
  TargetAdmissionRequestSchema,
  TargetCatalogResponseSchema,
  TargetPreflightResponseSchema,
  WorkflowDefinitionSchema,
  type CapabilityResponse,
  type CommandKind,
  type CommandResponse,
  type ContextAssociation,
  type ContextControlCommand,
  type ContextControlReceipt,
  type ContextOwnerAssociation,
  type ContextOwnerCatalog,
  type ContextOwnerEffectiveLimits,
  type DefinitionRecord,
  type DraftRecord,
  type EventPage,
  type ExportResponse,
  type InspectResponse,
  type JsonObject,
  type ProviderSessionList,
  type ReplayResponse,
  type RunEvent,
  type RunSnapshot,
  type RunSubmissionResponse,
  type StatusResponse,
  type TargetAdmissionBinding,
  type TargetAdmissionRequest,
  type TargetCatalogResponse,
  type TargetDescriptor,
  type TargetPreflightResponse,
  type ValidateResponse,
  type WorkflowDefinition,
} from "@studio/contracts";
import {
  canonicalJson,
  cloneDocument,
  definitionIdentityDigest,
  diffDocuments,
  semanticDigest,
  sha256Hex,
  validateNodeBindings,
} from "@studio/document";
import { CapabilityGateError, ClientError } from "./errors";
import { fixtureContextOwnerCatalog, fixtureTargetCatalog } from "./fixture-catalogs";
import { buildSafeCommand } from "./projection";
import {
  TARGET_CONFIGURATION_FIELDS,
  assertEqualBindingField,
  validateTargetAdmissionBinding,
  validateTargetConfiguration,
} from "./targets";
import { cloneJson } from "./transport";
import type { DraftWrite, PublishResult, RunSubmissionOptions, StudioClient } from "./types";

export class FixtureClient implements StudioClient {
  public readonly mode = "fixture" as const;
  private readonly definitions: DefinitionRecord[];
  private readonly targetCatalog: TargetCatalogResponse;
  private readonly drafts = new Map<string, DraftRecord>();
  private readonly runs = new Map<string, { definition: WorkflowDefinition; status: StatusResponse; events: RunEvent[] }>();
  private readonly targetAdmissionRequests = new Map<string, TargetAdmissionRequest>();
  private readonly submittedRuns = new Map<string, { fingerprint: string; response: RunSubmissionResponse }>();
  private nextRunNumber = 1;

  public constructor(definitions: DefinitionRecord[], options: { targets?: TargetDescriptor[] } = {}) {
    this.definitions = definitions.map((record) => DefinitionRecordSchema.parse(record));
    const baseCatalog = fixtureTargetCatalog();
    this.targetCatalog = TargetCatalogResponseSchema.parse({
      ...baseCatalog,
      targets: options.targets ?? baseCatalog.targets,
    });
  }

  public principal(): string {
    return "fixture";
  }

  public async listDefinitions(): Promise<DefinitionRecord[]> {
    return this.definitions.map((record) => DefinitionRecordSchema.parse(JSON.parse(JSON.stringify(record)) as unknown));
  }

  public async getDraft(draftId: string): Promise<DraftRecord | undefined> {
    const record = this.drafts.get(draftId);
    return record ? DraftRecordSchema.parse(JSON.parse(JSON.stringify(record)) as unknown) : undefined;
  }

  public async saveDraft(write: DraftWrite): Promise<DraftRecord> {
    const current = this.drafts.get(write.draftId);
    if (current && (current.etag !== write.etag || current.revision !== write.revision)) {
      const conflict: DraftRecord = {
        ...current,
        conflict: {
          serverRevision: current.revision,
          serverDocument: cloneDocument(current.document),
          serverLayout: JSON.parse(JSON.stringify(current.layout)) as JsonObject,
        },
      };
      this.drafts.set(write.draftId, conflict);
      return DraftRecordSchema.parse(JSON.parse(JSON.stringify(conflict)) as unknown);
    }
    const revision = current ? current.revision + 1 : 0;
    const record: DraftRecord = {
      draftId: write.draftId,
      definitionId: write.definitionId,
      revision,
      etag: `fixture-${revision}`,
      document: cloneDocument(write.document),
      layout: JSON.parse(JSON.stringify(write.layout)) as JsonObject,
      updatedAt: new Date().toISOString(),
      conflict: null,
    };
    this.drafts.set(write.draftId, record);
    return DraftRecordSchema.parse(JSON.parse(JSON.stringify(record)) as unknown);
  }

  public async publishDraft(draftId: string, expectedRevision: number, etag: string, definitionDigest: string): Promise<PublishResult> {
    const current = this.drafts.get(draftId);
    if (!current || current.revision !== expectedRevision || current.etag !== etag) {
      return { outcome: "conflict", draft: current ? DraftRecordSchema.parse(JSON.parse(JSON.stringify({ ...current, conflict: { serverRevision: current.revision, serverDocument: current.document, serverLayout: current.layout } })) as unknown) : undefined };
    }
    const digest = await semanticDigest(current.document);
    if (digest !== definitionDigest) {
      return { outcome: "conflict", draft: DraftRecordSchema.parse(JSON.parse(JSON.stringify({ ...current, conflict: { serverRevision: current.revision, serverDocument: current.document, serverLayout: current.layout } })) as unknown) };
    }
    const existing = this.definitions.find((definition) => definition.id === digest);
    if (existing) return { outcome: "already_published", definition: DefinitionRecordSchema.parse(JSON.parse(JSON.stringify(existing)) as unknown) };
    const definition = DefinitionRecordSchema.parse({
      id: digest,
      title: current.document.workflow_id,
      description: `Published revision ${current.document.version}`,
      source: "published",
      updatedAt: current.updatedAt,
      definition: current.document,
      capabilities: current.document.capabilities.required,
    });
    this.definitions.push(definition);
    return { outcome: "published", definition: DefinitionRecordSchema.parse(JSON.parse(JSON.stringify(definition)) as unknown) };
  }

  public async listTargets(): Promise<TargetCatalogResponse> {
    return TargetCatalogResponseSchema.parse(cloneJson(this.targetCatalog));
  }

  public async preflightTarget(request: TargetAdmissionRequest): Promise<TargetPreflightResponse> {
    const body = TargetAdmissionRequestSchema.parse(request);
    const catalog = this.targetCatalog;
    const prior = this.targetAdmissionRequests.get(body.request_id);
    if (prior && canonicalJson(prior) !== canonicalJson(body)) {
      throw new ClientError("The target request ID is already bound to a different configuration", "target_request_conflict", 409);
    }
    const descriptor = catalog.targets.find((target) => target.instance_id === body.target.instance_id);
    if (!descriptor) {
      throw new CapabilityGateError("The selected fixture target is unavailable.", "target_unavailable");
    }
    validateTargetConfiguration(descriptor, body.target);
    const descriptorDigest = await sha256Hex(canonicalJson(descriptor as unknown as JsonObject));
    const admission = TargetAdmissionBindingSchema.parse({
      schema_version: "ascension.workflow-admission/v1",
      request_id: body.request_id,
      workflow_definition_digest: body.workflow_definition_digest,
      target: body.target,
      descriptor_digest: descriptorDigest,
      catalog_revision: catalog.catalog_revision,
    });
    this.targetAdmissionRequests.set(body.request_id, cloneJson(body));
    return TargetPreflightResponseSchema.parse({
      schema_version: "ascension.workflow-admission/v1",
      admission,
    });
  }

  public async health(): Promise<{ status: string }> {
    return { status: "fixture" };
  }

  public async capabilities(): Promise<CapabilityResponse> {
    return {
      schema_version: "ascension.capabilities/v1",
      capabilities: {
        capabilities: ["observe.fair-play.v1", "actions.catalog.v1", "actions.settlement.v1", "studio.fixture.v1"],
        context_bindings: [
          { context_ref: "context.synthetic.v1", node_kinds: ["analyze", "decide"] },
        ],
      },
    };
  }

  public async listContextBindings(): Promise<ContextOwnerCatalog> {
    return fixtureContextOwnerCatalog();
  }

  public async contextOwnerAssociation(_runId: string): Promise<ContextOwnerAssociation> {
    throw new ClientError("The fixture has no current context owner association.", "context_owner_association_unavailable", 503);
  }

  public async contextOwnerEffectiveLimits(_runId: string): Promise<ContextOwnerEffectiveLimits> {
    throw new ClientError("The fixture has no current context owner effective limits.", "context_owner_effective_limits_unavailable", 503);
  }

  public async lookupContextControlReceipt(_runId: string, _command: ContextControlCommand): Promise<ContextControlReceipt> {
    throw new ClientError("The fixture has no historical context control receipt.", "context_control_receipt_not_recorded", 404);
  }

  public async validate(definition: WorkflowDefinition): Promise<ValidateResponse> {
    const diagnostics: ValidateResponse["diagnostics"] = [];
    for (const [graphIndex, graph] of definition.graphs.entries()) {
      const nodeIds = new Set(graph.nodes.map((node) => node.id));
      if (!nodeIds.has(graph.entry_node)) {
        diagnostics.push({ code: "entry_node_missing", severity: "error", path: `$.graphs[${graphIndex}].entry_node`, message: "Entry node is not present in the graph." });
      }
      for (const edge of graph.edges) {
        if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
          diagnostics.push({ code: "edge_endpoint_missing", severity: "error", path: `$.graphs[${graphIndex}].edges`, message: "Every edge endpoint must name a node in the same graph." });
        }
      }
    }
    for (const diagnostic of validateNodeBindings(definition)) {
      diagnostics.push({
        code: diagnostic.code,
        severity: "error",
        path: diagnostic.path,
        message: diagnostic.message,
      });
    }
    const digest = await semanticDigest(definition);
    return {
      schema_version: "ascension.management/v1",
      valid: diagnostics.every((diagnostic) => diagnostic.severity !== "error"),
      definition_digest: digest,
      diagnostics,
    };
  }

  public async inspect(definition: WorkflowDefinition): Promise<InspectResponse> {
    return {
      schema_version: "ascension.management/v1",
      definition_digest: await semanticDigest(definition),
      workflow_id: definition.workflow_id,
      workflow_version: definition.version,
      required_capabilities: definition.capabilities.required,
      graph_count: definition.graphs.length,
      node_count: definition.graphs.reduce((count, graph) => count + graph.nodes.length, 0),
    };
  }

  public async diff(oldDefinition: WorkflowDefinition, newDefinition: WorkflowDefinition): Promise<{
    old_definition_digest: string;
    new_definition_digest: string;
    semantic_change: boolean;
    changed_paths: string[];
  }> {
    const oldDigest = await semanticDigest(oldDefinition);
    const newDigest = await semanticDigest(newDefinition);
    return {
      old_definition_digest: oldDigest,
      new_definition_digest: newDigest,
      semantic_change: oldDigest !== newDigest,
      changed_paths: oldDigest === newDigest ? [] : diffDocuments(oldDefinition, newDefinition).map((change) => change.path),
    };
  }

  public async submitRun(
    definition: WorkflowDefinition,
    instanceId: string,
    profile: string,
    options: RunSubmissionOptions = {},
  ): Promise<RunSubmissionResponse> {
    const parsedDefinition = WorkflowDefinitionSchema.parse(definition);
    const admission = options.admission ? TargetAdmissionBindingSchema.parse(options.admission) : undefined;
    if (!admission) {
      throw new CapabilityGateError(
        "Workflow runs require an owner target preflight before submission",
        "target_admission_required",
      );
    }
    const requestId = options.requestId ?? admission.request_id;
    const reviewedRequest = this.targetAdmissionRequests.get(requestId);
    if (!reviewedRequest) {
      throw new ClientError(
        "Run submission requires a fixture target admission retained by this session",
        "target_admission_missing",
        409,
      );
    }
    validateTargetAdmissionBinding(admission, reviewedRequest);
    assertEqualBindingField("request_id", requestId, admission.request_id);
    assertEqualBindingField("target.instance_id", instanceId, admission.target.instance_id);
    assertEqualBindingField("target.execution_profile", profile, admission.target.execution_profile);
    if (options.target) {
      const reviewedTarget = RunTargetConfigurationSchema.parse(options.target);
      for (const field of TARGET_CONFIGURATION_FIELDS) {
        assertEqualBindingField(`target.${field}`, admission.target[field], reviewedTarget[field]);
      }
    }
    const digest = await definitionIdentityDigest(parsedDefinition);
    assertEqualBindingField("workflow_definition_digest", admission.workflow_definition_digest, digest);
    assertEqualBindingField("target.workflow_revision", admission.target.workflow_revision, parsedDefinition.version);
    assertEqualBindingField("target.game_profile", admission.target.game_profile, parsedDefinition.game_profile);
    const descriptor = this.targetCatalog.targets.find((target) => target.instance_id === admission.target.instance_id);
    if (!descriptor) {
      throw new CapabilityGateError("The selected fixture target is unavailable.", "target_unavailable");
    }
    validateTargetConfiguration(descriptor, admission.target);
    const descriptorDigest = await sha256Hex(canonicalJson(descriptor as unknown as JsonObject));
    assertEqualBindingField("descriptor_digest", admission.descriptor_digest, descriptorDigest);
    assertEqualBindingField("catalog_revision", admission.catalog_revision, this.targetCatalog.catalog_revision);
    const missingCapabilities = parsedDefinition.capabilities.required.filter((capability) => !descriptor.capabilities.includes(capability));
    if (missingCapabilities.length > 0) {
      throw new CapabilityGateError(
        `Fixture target does not advertise required capabilities: ${missingCapabilities.join(", ")}`,
        "target_capability_unavailable",
      );
    }
    const fingerprint = canonicalJson({
      workflow_definition_digest: digest,
      target: admission.target,
      descriptor_digest: admission.descriptor_digest,
      catalog_revision: admission.catalog_revision,
    });
    const existing = this.submittedRuns.get(requestId);
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        throw new ClientError("The run request ID is already bound to a different submission", "run_request_conflict", 409);
      }
      return cloneJson(existing.response);
    }
    const runId = `run.fixture.${this.nextRunNumber}`;
    this.nextRunNumber += 1;
    const snapshot = makeFixtureSnapshot(runId, digest, "running", 1, admission);
    const event = makeFixtureEvent(runId, digest, 1, "run_started", snapshot.cursor.node_execution_id);
    const status: StatusResponse = {
      schema_version: "ascension.workflow-status/v1",
      run: snapshot,
      accepted_plan_revision: null,
      waiting_reason: null,
      authority: { state: "fixture_projection", recovery: "fixture" },
      recovery_admission: { kind: "no_pending_effects" },
      last_progress_sequence: 1,
    };
    this.runs.set(runId, { definition: cloneDocument(parsedDefinition), status, events: [event] });
    const response = { schema_version: "ascension.workflow-run/v1", workflow_run_id: runId, run_revision: 1, status: "running" as const };
    this.submittedRuns.set(requestId, { fingerprint, response });
    return cloneJson(response);
  }

  public async status(runId: string): Promise<StatusResponse> {
    const run = this.runs.get(runId) ?? this.createDefaultRun(runId);
    return JSON.parse(JSON.stringify(run.status)) as StatusResponse;
  }

  public async events(runId: string, afterSequence: number, limit = 128): Promise<EventPage> {
    const run = this.runs.get(runId) ?? this.createDefaultRun(runId);
    const selected = run.events.filter((event) => event.sequence > afterSequence).slice(0, limit);
    return {
      schema_version: "ascension.workflow-event/v1",
      workflow_run_id: runId,
      after_sequence: afterSequence,
      oldest_sequence: run.events[0]?.sequence ?? null,
      newest_sequence: run.events.at(-1)?.sequence ?? null,
      next_after_sequence: selected.at(-1)?.sequence ?? afterSequence,
      gap: null,
      events: JSON.parse(JSON.stringify(selected)) as RunEvent[],
    };
  }

  public async contextAssociation(runId: string): Promise<ContextAssociation> {
    const run = this.runs.get(runId) ?? this.createDefaultRun(runId);
    return ContextAssociationSchema.parse({
      schema_version: "ascension.workflow-context-association/v1",
      workflow: {
        workflow_run_id: run.status.run.workflow_run_id,
        definition_digest: run.status.run.definition_digest,
        graph_id: run.status.run.cursor.graph_id,
        node_id: run.status.run.cursor.node_id,
        node_execution_id: run.status.run.cursor.node_execution_id,
      },
      context: { availability: "not_applicable", context_ref: null, run_id: null, episode_id: null, agent_id: null, snapshot_id: null, approved_revision_id: null, plan_epoch: null, reason_code: "fixture_context_adapter_unavailable" },
      capture: { mode: "unavailable", state: "unavailable", attempt_id: null, reason_code: "fixture_context_adapter_unavailable" },
      capabilities: { inspect_metadata: true, read_retained_content: false, edit_context: false, control_context: false, memory_search: false, provider_session_inspect: false },
    });
  }

  public async providerSessions(runId: string): Promise<ProviderSessionList> {
    const run = this.runs.get(runId) ?? this.createDefaultRun(runId);
    return ProviderSessionListSchema.parse({
      schema: "ascension.provider-session.api-result.v1",
      operation: "list",
      value: { run_id: run.status.run.workflow_run_id, bindings: [], operations: [], next_cursor: null },
      effect_class: "local_metadata_only",
      inference_calls: 0,
      game_effects: 0,
    });
  }

  public async command(runId: string, expectedRevision: number, kind: CommandKind, _commandId?: string): Promise<CommandResponse> {
    const safe = buildSafeCommand(runId, expectedRevision, kind);
    const run = this.runs.get(runId) ?? this.createDefaultRun(runId);
    if (run.status.run.run_revision !== safe.expectedRevision) {
      throw new ClientError("Fixture run revision is stale", "stale_revision", 409);
    }
    const nextRevision = run.status.run.run_revision + 1;
    const status: RunSnapshot["status"] = kind === "pause" ? "paused" : kind === "cancel" ? "cancelled" : kind === "resume" ? "running" : "running";
    run.status.run = { ...run.status.run, run_revision: nextRevision, status };
    run.status.last_progress_sequence += 1;
    const event = makeFixtureEvent(runId, run.status.run.definition_digest, run.status.last_progress_sequence, "command_applied", run.status.run.cursor.node_execution_id);
    run.events.push(event);
    return {
      schema_version: "ascension.management/v1",
      command_id: `fixture.command.${nextRevision}`,
      workflow_run_id: runId,
      outcome: "applied",
      run_revision: nextRevision,
      sequence: event.sequence,
    };
  }

  public async replay(runId: string): Promise<ReplayResponse> {
    const run = this.runs.get(runId) ?? this.createDefaultRun(runId);
    return { schema_version: "ascension.workflow-replay/v1", workflow_run_id: runId, matched: true, compared_events: run.events.length, first_divergence: null };
  }

  public async export(runId: string): Promise<ExportResponse> {
    const run = this.runs.get(runId) ?? this.createDefaultRun(runId);
    return { schema_version: "ascension.workflow-export/v1", workflow_run_id: runId, redacted: true, run: run.status.run, events: run.events };
  }

  private createDefaultRun(runId: string): { definition: WorkflowDefinition; status: StatusResponse; events: RunEvent[] } {
    const definition = this.definitions[0]?.definition;
    if (!definition) {
      throw new ClientError("Fixture catalog has no definition", "fixture_empty");
    }
    const digest = "f".repeat(64);
    const snapshot = makeFixtureSnapshot(runId, digest, "paused", 1);
    const event = makeFixtureEvent(runId, digest, 1, "run_started", snapshot.cursor.node_execution_id);
    const run = {
      definition: cloneDocument(definition),
      status: {
        schema_version: "ascension.workflow-status/v1",
        run: snapshot,
        accepted_plan_revision: null,
        waiting_reason: "Fixture inspection run",
        authority: { state: "fixture_projection", recovery: "fixture" },
        recovery_admission: { kind: "no_pending_effects" as const },
        last_progress_sequence: 1,
      },
      events: [event],
    };
    this.runs.set(runId, run);
    return run;
  }
}

function makeFixtureSnapshot(
  runId: string,
  digest: string,
  status: RunSnapshot["status"],
  revision: number,
  admission?: TargetAdmissionBinding,
): RunSnapshot {
  return {
    schema_version: "ascension.workflow-run/v1",
    workflow_run_id: runId,
    definition_digest: digest,
    run_revision: revision,
    status,
    game_outcome: "not_terminal",
    cursor: { graph_id: "main", node_id: "observe", node_execution_id: `${runId}.node.1` },
    pending_operation: null,
    budget: { provider_calls_consumed: 0, provider_calls_reserved: 0, node_steps_consumed: 1, replans_consumed: 0 },
    cleanup: "not_started",
    ...(admission ? { admission: cloneJson(admission) } : {}),
  };
}

function makeFixtureEvent(runId: string, digest: string, sequence: number, eventType: RunEvent["event_type"], nodeExecutionId: string): RunEvent {
  return {
    schema_version: "ascension.workflow-event/v1",
    workflow_run_id: runId,
    sequence,
    run_revision: sequence,
    event_type: eventType,
    definition_digest: digest,
    node_execution_id: nodeExecutionId,
    payload: { operation_id: null, classification: eventType === "command_applied" ? "settled" : null, reason_code: eventType },
    integrity_digest: null,
  };
}
