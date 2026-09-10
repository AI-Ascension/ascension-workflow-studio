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
    max_output_tokens: z.number().int().positive(),
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

export const HealthResponseSchema = z.object({
  schema_version: z.string(),
  status: z.string(),
}).strict();

export const CapabilityResponseSchema = z.object({
  schema_version: z.string(),
  capabilities: JsonValueSchema,
}).strict();
export type CapabilityResponse = z.infer<typeof CapabilityResponseSchema>;

export const ValidateResponseSchema = z.object({
  schema_version: z.string(),
  valid: z.boolean(),
  definition_digest: z.string(),
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
}).strict();
export type DefinitionRecord = z.infer<typeof DefinitionRecordSchema>;

export const DraftRecordSchema = z.object({
  draftId: z.string(),
  definitionId: z.string(),
  revision: z.number().int().nonnegative(),
  etag: z.string(),
  document: WorkflowDefinitionSchema,
  updatedAt: z.string(),
  conflict: z.object({
    serverRevision: z.number().int().nonnegative(),
    serverDocument: WorkflowDefinitionSchema,
  }).strict().nullable(),
}).strict();
export type DraftRecord = z.infer<typeof DraftRecordSchema>;

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
