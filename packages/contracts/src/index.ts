import { z } from "zod";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ]),
);

export const JsonObjectSchema = z.record(z.string(), JsonValueSchema);

export const WorkflowNodeSchema = z.object({
  id: z.string().min(1).max(128),
  kind: z.string().min(1).max(128),
  config: JsonObjectSchema,
}).strict();

export const WorkflowEdgeSchema = z.object({
  from: z.string().min(1).max(128),
  to: z.string().min(1).max(128),
  on: z.string().min(1).max(128),
  priority: z.number().int().nonnegative(),
  /** Optional owner guard selected for this control edge. */
  guard_ref: z.string().min(1).max(128).optional(),
}).strict();

export const WorkflowGuardSchema = z.object({
  id: z.string().min(1).max(128),
  expression: JsonObjectSchema,
}).strict();

export const WorkflowGraphSchema = z.object({
  id: z.string().min(1).max(128),
  entry_node: z.string().min(1).max(128),
  nodes: z.array(WorkflowNodeSchema).max(512),
  edges: z.array(WorkflowEdgeSchema).max(2048),
  guards: z.array(WorkflowGuardSchema).max(256).optional(),
}).strict();

export const WorkflowDefinitionSchema = z.object({
  schema_version: z.literal("ascension.workflow/v1"),
  workflow_id: z.string().min(1).max(128),
  version: z.string().min(1).max(64),
  mode: z.enum(["strict", "dynamic"]),
  game_profile: z.string().min(1).max(128),
  policy_ref: z.string().min(1).max(128),
  capabilities: z.object({
    required: z.array(z.string().min(1).max(128)).max(128),
    optional: z.array(z.string().min(1).max(128)).max(128),
  }).strict(),
  limits: z.object({
    max_steps: z.number().int().positive(),
    max_subworkflow_depth: z.number().int().nonnegative(),
    max_provider_calls: z.number().int().nonnegative(),
    max_parallel_analyses: z.number().int().positive(),
    max_output_tokens: z.number().int().nonnegative(),
  }).strict(),
  entry_graph: z.string().min(1).max(128),
  graphs: z.array(WorkflowGraphSchema).min(1).max(128),
  annotations: JsonObjectSchema.optional(),
}).strict();

export type WorkflowDefinition = z.infer<typeof WorkflowDefinitionSchema>;
export type WorkflowGraph = z.infer<typeof WorkflowGraphSchema>;
export type WorkflowNode = z.infer<typeof WorkflowNodeSchema>;
export type WorkflowEdge = z.infer<typeof WorkflowEdgeSchema>;
export type WorkflowMode = WorkflowDefinition["mode"];

export const WorkflowRunStatusSchema = z.enum([
  "created",
  "validated",
  "running",
  "waiting_for_provider",
  "waiting_for_game",
  "pausing",
  "paused",
  "cancelling",
  "reconciling",
  "completed",
  "failed",
  "cancelled",
  "needs_operator",
]);
export type WorkflowRunStatus = z.infer<typeof WorkflowRunStatusSchema>;

export const RecoveryAdmissionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("no_pending_effects") }).strict(),
  z.object({ kind: z.literal("reconciling") }).strict(),
  z.object({ kind: z.literal("safely_resumable"), capability: z.string() }).strict(),
  z.object({ kind: z.literal("needs_operator") }).strict(),
  z.object({ kind: z.literal("terminal_verified_cleanup") }).strict(),
]);

export const RunSnapshotSchema = z.object({
  schema_version: z.string(),
  workflow_run_id: z.string(),
  definition_digest: z.string(),
  run_revision: z.number().int().nonnegative(),
  status: WorkflowRunStatusSchema,
  game_outcome: z.enum(["not_terminal", "victory", "defeat", "unknown"]),
  cursor: z.object({
    graph_id: z.string(),
    node_id: z.string(),
    node_execution_id: z.string(),
  }).strict(),
  pending_operation: z.object({
    operation_id: z.string(),
    state: z.enum(["intent", "accepted", "unknown"]),
    instance_id: z.string(),
    original_generation: z.number().int().nonnegative(),
    payload_digest: z.string(),
  }).strict().nullable(),
  budget: z.object({
    provider_calls_consumed: z.number().int().nonnegative(),
    provider_calls_reserved: z.number().int().nonnegative(),
    node_steps_consumed: z.number().int().nonnegative(),
    replans_consumed: z.number().int().nonnegative(),
  }).strict(),
  cleanup: z.enum(["not_started", "pending", "complete", "failed", "needs_operator"]),
  admission: z.lazy(() => TargetAdmissionBindingSchema).optional(),
}).strict();
export type RunSnapshot = z.infer<typeof RunSnapshotSchema>;

export const RunEventSchema = z.object({
  schema_version: z.string(),
  workflow_run_id: z.string(),
  sequence: z.number().int().positive(),
  run_revision: z.number().int().nonnegative(),
  event_type: z.enum([
    "run_started",
    "node_entered",
    "node_completed",
    "plan_accepted",
    "plan_rejected",
    "operation_intent",
    "operation_unknown",
    "operation_settled",
    "command_requested",
    "command_applied",
    "run_terminal",
  ]),
  definition_digest: z.string(),
  node_execution_id: z.string(),
  payload: z.object({
    operation_id: z.string().nullable(),
    classification: z.enum(["accepted", "unknown", "settled", "rejected", "cancelled"]).nullable(),
    reason_code: z.string(),
  }).strict(),
  integrity_digest: z.string().nullable().optional(),
}).strict();
export type RunEvent = z.infer<typeof RunEventSchema>;

export const EventPageSchema = z.object({
  schema_version: z.string(),
  workflow_run_id: z.string(),
  after_sequence: z.number().int().nonnegative(),
  oldest_sequence: z.number().int().positive().nullable(),
  newest_sequence: z.number().int().positive().nullable(),
  next_after_sequence: z.number().int().nonnegative(),
  gap: z.object({
    requested_after_sequence: z.number().int().nonnegative(),
    oldest_sequence: z.number().int().positive(),
    newest_sequence: z.number().int().positive(),
  }).strict().nullable(),
  events: z.array(RunEventSchema),
}).strict();
export type EventPage = z.infer<typeof EventPageSchema>;

/** Redacted association of the current workflow cursor to owner context evidence. */
export const ContextAssociationSchema = z.object({
  schema_version: z.literal("ascension.workflow-context-association/v1"),
  workflow: z.object({
    workflow_run_id: z.string().min(1).max(128),
    definition_digest: z.string().regex(/^[a-f0-9]{64}$/),
    graph_id: z.string().min(1).max(128),
    node_id: z.string().min(1).max(128),
    node_execution_id: z.string().min(1).max(128),
  }).strict(),
  context: z.object({
    availability: z.enum(["available", "unavailable", "not_applicable"]),
    context_ref: z.string().min(1).max(128).nullable(),
    run_id: z.string().min(1).max(128).nullable(),
    episode_id: z.string().min(1).max(128).nullable(),
    agent_id: z.string().min(1).max(128).nullable(),
    snapshot_id: z.string().min(1).max(128).nullable(),
    approved_revision_id: z.string().min(1).max(128).nullable(),
    plan_epoch: z.number().int().nonnegative().nullable(),
    reason_code: z.string().min(1).max(128).optional(),
  }).strict(),
  capture: z.object({
    mode: z.enum(["off", "metadata", "memory", "private", "unavailable"]),
    state: z.enum(["not_captured", "prepared", "input_write_completed", "provider_receipt_reported", "unknown", "unavailable"]),
    attempt_id: z.string().min(1).max(128).nullable(),
    reason_code: z.string().min(1).max(128).optional(),
  }).strict(),
  capabilities: z.object({
    inspect_metadata: z.boolean(),
    read_retained_content: z.boolean(),
    edit_context: z.boolean(),
    control_context: z.boolean(),
    memory_search: z.boolean(),
    provider_session_inspect: z.boolean(),
  }).strict(),
}).strict().superRefine((value, context) => {
  if (value.context.availability !== "available") {
    if ([value.context.context_ref, value.context.run_id, value.context.episode_id, value.context.agent_id, value.context.snapshot_id, value.context.approved_revision_id, value.context.plan_epoch].some((item) => item !== null)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Unavailable context association must not contain inferred identities." });
    }
    return;
  }
  if ([value.context.context_ref, value.context.run_id, value.context.episode_id, value.context.agent_id, value.context.snapshot_id, value.context.approved_revision_id].some((item) => item === null) || !value.context.plan_epoch) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Available context association requires all bound identities and a positive plan epoch." });
  }
});
export type ContextAssociation = z.infer<typeof ContextAssociationSchema>;

const ContextScopeSchema = z.object({
  project_id: z.string().min(1).max(128),
  run_id: z.string().min(1).max(128),
  episode_id: z.string().min(1).max(128),
  agent_id: z.string().min(1).max(128),
}).strict();

export const MemoryCapabilitiesSchema = z.object({
  schema: z.literal("ascension.context-memory.capabilities.v1"),
  product_phase: z.literal(3),
  scope: ContextScopeSchema,
  enabled: z.boolean(),
  supported_operations: z.array(z.string()).max(32),
  phase2_approval_required: z.boolean(),
  persistent_provider_sessions: z.boolean(),
  provider_side_compaction: z.boolean(),
  hidden_reasoning_access: z.boolean(),
  direct_game_dispatch: z.boolean(),
}).passthrough();
export type MemoryCapabilities = z.infer<typeof MemoryCapabilitiesSchema>;

export const ProviderSessionListSchema = z.object({
  schema: z.literal("ascension.provider-session.api-result.v1"),
  operation: z.literal("list"),
  value: z.object({
    run_id: z.string().min(1).max(128),
    bindings: z.array(z.object({
      binding_id: z.string().min(1).max(128),
      state: z.string().min(1).max(128),
      history_coverage: z.string().min(1).max(128),
      game_dispatch_capability: z.boolean(),
    }).passthrough()).max(128),
    operations: z.array(z.object({
      operation_id: z.string().min(1).max(128),
      state: z.string().min(1).max(128),
      game_effects: z.number().int().nonnegative(),
      auto_resume: z.boolean(),
    }).passthrough()).max(128),
    next_cursor: z.string().nullable(),
  }).strict(),
  effect_class: z.literal("local_metadata_only"),
  inference_calls: z.literal(0),
  game_effects: z.literal(0),
}).strict();
export type ProviderSessionList = z.infer<typeof ProviderSessionListSchema>;

/** Bounded, metadata-only projection returned by the Context owner read API.
 * Retained component bytes deliberately have no representation in Studio. */
export const ContextSnapshotSummarySchema = z.object({
  snapshot_id: z.string().min(1).max(128),
  run_id: z.string().min(1).max(128),
  episode_id: z.string().min(1).max(128),
  boundary: z.string().min(1).max(128),
  capture_mode: z.string().min(1).max(128),
  component_count: z.number().int().nonnegative(),
  application_capture_complete: z.boolean(),
  incomplete_reasons: z.array(z.string().min(1).max(128)).max(64),
}).strict();
export type ContextSnapshotSummary = z.infer<typeof ContextSnapshotSummarySchema>;

export const ContextSnapshotListSchema = z.object({
  run_id: z.string().min(1).max(128),
  snapshots: z.array(ContextSnapshotSummarySchema).max(200),
  next_cursor: z.null(),
}).strict();
export type ContextSnapshotList = z.infer<typeof ContextSnapshotListSchema>;

export const ContextComparisonSchema = z.object({
  comparison: z.object({
    left_snapshot_id: z.string().min(1).max(128),
    right_snapshot_id: z.string().min(1).max(128),
    same_boundary: z.boolean(),
    same_component_order: z.boolean(),
    changed_components: z.array(z.string().min(1).max(128)).max(128),
  }).strict(),
  read_only: z.literal(true),
}).strict();
export type ContextComparison = z.infer<typeof ContextComparisonSchema>;

const ContextIdentifierSchema = z.string().min(1).max(128);
export const ContextSnapshotManifestSchema = z.object({
  schema: z.literal("ascension.context-snapshot.v1"),
  snapshot_id: ContextIdentifierSchema,
  identity: z.object({ run_id: ContextIdentifierSchema, episode_id: ContextIdentifierSchema, agent_id: ContextIdentifierSchema, model_execution_id: ContextIdentifierSchema, provider_attempt_id: ContextIdentifierSchema }).strict(),
  boundary: ContextIdentifierSchema,
  capture_mode: z.enum(["metadata", "memory", "private"]),
  application_capture_complete: z.boolean(),
  incomplete_reasons: z.array(ContextIdentifierSchema).max(16),
  components: z.array(z.object({
    component_id: ContextIdentifierSchema,
    ordinal: z.number().int().nonnegative().max(127),
    kind: ContextIdentifierSchema,
    role: z.string().nullable(),
    media_type: z.string().min(1).max(128),
    observed_bytes: z.number().int().nonnegative(),
    content_status: ContextIdentifierSchema,
  }).strip()).min(1).max(128),
}).strip();
export type ContextSnapshotManifest = z.infer<typeof ContextSnapshotManifestSchema>;

export const ContextEventPageSchema = z.object({
  run_id: ContextIdentifierSchema,
  events: z.array(z.object({
    event_id: ContextIdentifierSchema,
    producer_id: ContextIdentifierSchema,
    sequence: z.number().int().nonnegative(),
    snapshot_id: ContextIdentifierSchema,
    provider_attempt_id: ContextIdentifierSchema,
    observed_at: z.string().min(1).max(128),
    event_type: ContextIdentifierSchema,
  }).strip()).max(200),
  next_cursor: z.string().min(1).max(2048).nullable(),
  gap: z.boolean(),
  offline: z.literal(false),
}).strict();
export type ContextEventPage = z.infer<typeof ContextEventPageSchema>;

export const HealthResponseSchema = z.object({
  schema_version: z.string(),
  status: z.string(),
}).strict();

export const CapabilityResponseSchema = z.object({
  schema_version: z.string(),
  capabilities: JsonValueSchema,
}).strict();
export type CapabilityResponse = z.infer<typeof CapabilityResponseSchema>;

export const ExecutionModeSchema = z.enum(["synthetic", "live"]);
export type ExecutionMode = z.infer<typeof ExecutionModeSchema>;

export const TargetAvailabilitySchema = z.enum(["available", "unavailable", "revoked", "expired"]);
export type TargetAvailability = z.infer<typeof TargetAvailabilitySchema>;

export const TargetDescriptorSchema = z.object({
  instance_id: z.string().min(1).max(128),
  execution_profiles: z.array(z.string().min(1).max(128)).max(32),
  execution_mode: ExecutionModeSchema,
  compatibility_revision: z.string().min(1).max(128),
  capability_revision: z.string().min(1).max(128),
  availability: TargetAvailabilitySchema,
  supported_operations: z.array(z.string().min(1).max(128)).max(64),
  capabilities: z.array(z.string().min(1).max(128)).max(256),
  game_profiles: z.array(z.string().min(1).max(128)).max(32),
  save_profiles: z.array(z.string().min(1).max(128)).max(32),
  inference_profiles: z.array(z.string().min(1).max(128)).max(32),
}).strict();
export type TargetDescriptor = z.infer<typeof TargetDescriptorSchema>;

export const TargetCatalogResponseSchema = z.object({
  schema_version: z.literal("ascension.workflow-targets/v1"),
  catalog_revision: z.string().min(1).max(128),
  targets: z.array(TargetDescriptorSchema).max(32),
}).strict();
export type TargetCatalogResponse = z.infer<typeof TargetCatalogResponseSchema>;

/**
 * Exact target/profile namespaces selected for a run. This is deliberately
 * separate from the workflow's game_profile and from owner-issued admission.
 */
export const RunTargetConfigurationSchema = z.object({
  instance_id: z.string().min(1).max(128),
  execution_profile: z.string().min(1).max(128),
  execution_mode: ExecutionModeSchema,
  workflow_revision: z.string().min(1).max(128),
  compatibility_revision: z.string().min(1).max(128),
  capability_revision: z.string().min(1).max(128),
  game_profile: z.string().min(1).max(128),
  save_profile: z.string().min(1).max(128).nullable(),
  inference_profile: z.string().min(1).max(128).nullable(),
  context_capability: z.string().min(1).max(128).nullable(),
  provider_capability: z.string().min(1).max(128).nullable(),
}).strict();
export type RunTargetConfiguration = z.infer<typeof RunTargetConfigurationSchema>;

export const TargetAdmissionRequestSchema = z.object({
  schema_version: z.literal("ascension.workflow-admission/v1"),
  request_id: z.string().min(1).max(128),
  workflow_definition_digest: z.string().regex(/^[a-f0-9]{64}$/),
  target: RunTargetConfigurationSchema,
}).strict();
export type TargetAdmissionRequest = z.infer<typeof TargetAdmissionRequestSchema>;

export const TargetAdmissionBindingSchema = z.object({
  schema_version: z.literal("ascension.workflow-admission/v1"),
  request_id: z.string().min(1).max(128),
  workflow_definition_digest: z.string().regex(/^[a-f0-9]{64}$/),
  target: RunTargetConfigurationSchema,
  descriptor_digest: z.string().regex(/^[a-f0-9]{64}$/),
  catalog_revision: z.string().min(1).max(128),
}).strict();
export type TargetAdmissionBinding = z.infer<typeof TargetAdmissionBindingSchema>;

export const TargetPreflightResponseSchema = z.object({
  schema_version: z.literal("ascension.workflow-admission/v1"),
  admission: TargetAdmissionBindingSchema,
}).strict();
export type TargetPreflightResponse = z.infer<typeof TargetPreflightResponseSchema>;

export const ContextBindingSchema = z.object({
  context_ref: z.string().min(1).max(128),
  node_kinds: z.array(z.enum(["analyze", "decide"])).min(1).max(2),
}).strict();
export type ContextBinding = z.infer<typeof ContextBindingSchema>;

/** Extract only the bounded authoring metadata from an otherwise owner-defined
 * capability document. Unknown owner capabilities remain opaque. */
export function contextBindingsFromCapabilities(value: JsonValue): ContextBinding[] | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const candidate = (value as JsonObject).context_bindings;
  if (!Array.isArray(candidate)) return undefined;
  const parsed = z.array(ContextBindingSchema).max(128).safeParse(candidate);
  return parsed.success ? parsed.data : undefined;
}

export const ValidateResponseSchema = z.object({
  schema_version: z.string(),
  valid: z.boolean(),
  definition_digest: z.string(),
  compiler: z.string().optional(),
  diagnostics: z.array(z.object({
    code: z.string(),
    severity: z.enum(["error", "warning", "info"]),
    path: z.string(),
    message: z.string(),
  }).strict()),
}).strict();
export type ValidateResponse = z.infer<typeof ValidateResponseSchema>;

export const InspectResponseSchema = z.object({
  schema_version: z.string(),
  definition_digest: z.string(),
  workflow_id: z.string().nullable(),
  workflow_version: z.string().nullable(),
  required_capabilities: z.array(z.string()),
  graph_count: z.number().int().nonnegative(),
  node_count: z.number().int().nonnegative(),
}).strict();
export type InspectResponse = z.infer<typeof InspectResponseSchema>;

export const DiffResponseSchema = z.object({
  schema_version: z.string(),
  old_definition_digest: z.string(),
  new_definition_digest: z.string(),
  semantic_change: z.boolean(),
  changed_paths: z.array(z.string()),
}).strict();
export type DiffResponse = z.infer<typeof DiffResponseSchema>;

export const RunSubmissionResponseSchema = z.object({
  schema_version: z.string(),
  workflow_run_id: z.string(),
  run_revision: z.number().int().nonnegative(),
  status: WorkflowRunStatusSchema,
}).strict();
export type RunSubmissionResponse = z.infer<typeof RunSubmissionResponseSchema>;

export const StatusResponseSchema = z.object({
  schema_version: z.string(),
  run: RunSnapshotSchema,
  accepted_plan_revision: z.number().int().nonnegative().nullable(),
  waiting_reason: z.string().nullable(),
  authority: z.object({ state: z.string(), recovery: z.string() }).strict(),
  recovery_admission: RecoveryAdmissionSchema,
  last_progress_sequence: z.number().int().nonnegative(),
}).strict();
export type StatusResponse = z.infer<typeof StatusResponseSchema>;

export const CommandResponseSchema = z.object({
  schema_version: z.string(),
  command_id: z.string(),
  workflow_run_id: z.string(),
  outcome: z.enum(["accepted", "applied", "pending", "duplicate"]),
  run_revision: z.number().int().nonnegative(),
  sequence: z.number().int().positive().nullable(),
}).strict();
export type CommandResponse = z.infer<typeof CommandResponseSchema>;

export const ReplayResponseSchema = z.object({
  schema_version: z.string(),
  workflow_run_id: z.string(),
  matched: z.boolean(),
  compared_events: z.number().int().nonnegative(),
  first_divergence: z.object({ path: z.string(), code: z.string() }).strict().nullable(),
}).strict();
export type ReplayResponse = z.infer<typeof ReplayResponseSchema>;

export const ExportResponseSchema = z.object({
  schema_version: z.string(),
  workflow_run_id: z.string(),
  redacted: z.boolean(),
  run: RunSnapshotSchema,
  events: z.array(RunEventSchema),
}).strict();
export type ExportResponse = z.infer<typeof ExportResponseSchema>;

export const ErrorResponseSchema = z.object({
  schema_version: z.string(),
  error: z.object({
    class: z.string(),
    code: z.string(),
    message: z.string(),
  }).strict(),
}).strict();

export type CommandKind = "pause" | "resume" | "step" | "cancel";

export const DefinitionRecordSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  source: z.enum(["catalog", "draft", "published"]),
  updatedAt: z.string(),
  definition: WorkflowDefinitionSchema,
  capabilities: z.array(z.string()),
  definitionDigest: z.string().optional(),
}).strict();
export type DefinitionRecord = z.infer<typeof DefinitionRecordSchema>;

export const DraftRecordSchema = z.object({
  draftId: z.string(),
  definitionId: z.string(),
  revision: z.number().int().nonnegative(),
  etag: z.string(),
  document: WorkflowDefinitionSchema,
  layout: JsonObjectSchema,
  updatedAt: z.string(),
  conflict: z.object({
    serverRevision: z.number().int().nonnegative(),
    serverDocument: WorkflowDefinitionSchema,
    serverLayout: JsonObjectSchema,
  }).strict().nullable(),
}).strict();
export type DraftRecord = z.infer<typeof DraftRecordSchema>;

export const StudioOwnerDefinitionSchema = z.object({
  schema_version: z.literal("ascension.studio-authoring/v1"),
  id: z.string(),
  title: z.string(),
  description: z.string(),
  source: z.literal("published"),
  version: z.string(),
  definition_digest: z.string(),
  definition: WorkflowDefinitionSchema,
  published_revision: z.number().int().nonnegative(),
}).strict();
export type StudioOwnerDefinition = z.infer<typeof StudioOwnerDefinitionSchema>;

export const StudioOwnerDefinitionsResponseSchema = z.object({
  schema_version: z.literal("ascension.studio-authoring/v1"),
  definitions: z.array(StudioOwnerDefinitionSchema),
}).strict();

export const StudioOwnerDraftConflictSchema = z.object({
  server_revision: z.number().int().nonnegative(),
  server_etag: z.string(),
  server_document: JsonValueSchema,
  server_layout: JsonObjectSchema,
}).strict();

export const StudioOwnerDraftSchema = z.object({
  schema_version: z.literal("ascension.studio-authoring/v1"),
  draft_id: z.string(),
  definition_id: z.string(),
  revision: z.number().int().nonnegative(),
  etag: z.string(),
  document: JsonValueSchema,
  layout: JsonObjectSchema,
  updated_at: z.string(),
  conflict: StudioOwnerDraftConflictSchema.nullable(),
}).strict();
export type StudioOwnerDraft = z.infer<typeof StudioOwnerDraftSchema>;

export const StudioOwnerCreateDraftRequestSchema = z.object({
  schema_version: z.literal("ascension.studio-authoring/v1"),
  draft_id: z.string(),
  definition_id: z.string(),
  document: JsonValueSchema,
  layout: JsonObjectSchema,
  client_mutation_id: z.string(),
}).strict();

export const StudioOwnerSaveDraftRequestSchema = z.object({
  schema_version: z.literal("ascension.studio-authoring/v1"),
  expected_revision: z.number().int().nonnegative(),
  etag: z.string(),
  client_mutation_id: z.string(),
  document: JsonValueSchema,
  layout: JsonObjectSchema,
}).strict();

export const StudioOwnerPublishResponseSchema = z.object({
  schema_version: z.literal("ascension.studio-authoring/v1"),
  outcome: z.enum(["published", "already_published", "conflict"]),
  definition: StudioOwnerDefinitionSchema.nullable(),
  draft: StudioOwnerDraftSchema.nullable(),
}).strict();

export const LayoutSidecarSchema = z.object({
  schemaVersion: z.literal("ascension.studio-layout/v1"),
  semanticDigest: z.string(),
  positions: z.record(z.string(), z.object({
    x: z.number().finite(),
    y: z.number().finite(),
  }).strict()),
}).strict();
export type LayoutSidecar = z.infer<typeof LayoutSidecarSchema>;

export function decodeWith<T>(schema: z.ZodType<T>, input: unknown, label: string): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new Error(`${label} failed runtime decoding: ${result.error.message}`);
  }
  return result.data;
}

export function isJsonObject(value: JsonValue): value is { [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
