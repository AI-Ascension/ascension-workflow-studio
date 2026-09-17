import { z } from "zod";

const ContextBoundarySchema = z.object({
  run_id: z.string().min(1).max(128),
  episode_id: z.string().min(1).max(128),
  agent_id: z.string().min(1).max(128),
  state_id: z.string().min(1).max(128),
  generation: z.number().int().nonnegative(),
  observation_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  catalog_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  adapter_revision: z.string().min(1).max(128),
  model_revision: z.string().min(1).max(128),
  configuration_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  output_schema_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  controller_epoch: z.number().int().positive(),
  gate_epoch: z.number().int().positive(),
  control_version: z.number().int().nonnegative(),
}).strict();

const ContextBindingGrantsSchema = z.object({
  metadata_read: z.boolean(),
  content_read: z.boolean(),
  edit: z.boolean(),
  control: z.boolean(),
}).strict();

const ContextBindingContinuitySchema = z.object({
  survives_controller_restart: z.boolean(),
  receipt_recovery: z.boolean(),
  provider_session_continuity: z.boolean(),
}).strict();

const ContextEffectiveLimitsSchema = z.object({
  max_items: z.number().int().nonnegative(),
  max_notes: z.number().int().nonnegative(),
  max_context_bytes: z.number().int().nonnegative(),
  max_objective_bytes: z.number().int().nonnegative(),
  max_control_events: z.number().int().nonnegative(),
}).strict();

const ContextOwnerBindingSchema = z.object({
  schema_version: z.literal("ascension.context-control.owner-binding.v1"),
  owner_id: z.string().min(1).max(128),
  owner_version: z.string().min(1).max(128),
  invocation_id: z.string().min(1).max(128),
  binding_id: z.string().min(1).max(128),
  binding_version: z.number().int().positive(),
  binding_digest: z.string().regex(/^[a-f0-9]{64}$/),
  context_ref: z.string().min(1).max(128),
  instance_id: z.string().min(1).max(128),
  node_kind: z.string().min(1).max(128),
  state: z.enum(["available", "disabled", "unattached", "denied", "stale", "unsupported"]),
  workflow_run_id: z.string().min(1).max(128),
  definition_digest: z.string().regex(/^[a-f0-9]{64}$/),
  graph_id: z.string().min(1).max(128),
  node_id: z.string().min(1).max(128),
  node_execution_id: z.string().min(1).max(128),
  boundary: ContextBoundarySchema,
  lease_epoch: z.number().int().positive(),
  snapshot_id: z.string().min(1).max(128),
  approved_revision_id: z.string().min(1).max(128),
  plan_epoch: z.number().int().positive(),
  grants: ContextBindingGrantsSchema,
  continuity: ContextBindingContinuitySchema,
}).strict();

export const ContextOwnerAssociationSchema = z.object({
  schema_version: z.literal("ascension.harness.context-owner-association-view.v1"),
  binding: ContextOwnerBindingSchema,
}).strict();
export type ContextOwnerAssociation = z.infer<typeof ContextOwnerAssociationSchema>;

export const ContextOwnerEffectiveLimitsSchema = z.object({
  schema_version: z.literal("ascension.harness.context-owner-effective-limits-view.v1"),
  owner_id: z.string().min(1).max(128),
  owner_version: z.string().min(1).max(128),
  catalog_digest: z.string().regex(/^[a-f0-9]{64}$/),
  binding_id: z.string().min(1).max(128),
  binding_version: z.number().int().positive(),
  binding_digest: z.string().regex(/^[a-f0-9]{64}$/),
  context_ref: z.string().min(1).max(128),
  node_kind: z.string().min(1).max(128),
  adapter_revision: z.string().min(1).max(128),
  model_revision: z.string().min(1).max(128),
  effective_limits: ContextEffectiveLimitsSchema,
}).strict();
export type ContextOwnerEffectiveLimits = z.infer<typeof ContextOwnerEffectiveLimitsSchema>;

const ContextControlCommandBase = z.object({
  idempotency_key: z.string().min(1).max(128),
});
export const ContextControlCommandSchema = z.union([
  z.object({
    pause: ContextControlCommandBase.extend({
      expected_control_version: z.number().int().nonnegative(),
    }).strict(),
  }).strict(),
  z.object({
    commit: ContextControlCommandBase.extend({
      expected_control_version: z.number().int().nonnegative(),
      expected_revision_id: z.string().min(1).max(128),
      expected_boundary: ContextBoundarySchema,
      preview_manifest_digest: z.string().regex(/^[a-f0-9]{64}$/),
      approved_manifest_digest: z.string().regex(/^[a-f0-9]{64}$/),
    }).strict(),
  }).strict(),
  z.object({
    resume: ContextControlCommandBase.extend({
      expected_control_version: z.number().int().nonnegative(),
      expected_boundary: ContextBoundarySchema,
    }).strict(),
  }).strict(),
]);
export type ContextControlCommand = z.infer<typeof ContextControlCommandSchema>;

export const ContextControlReceiptSchema = z.object({
  schema_version: z.literal("ascension.context-control.owner-receipt.v2"),
  owner_id: z.string().min(1).max(128),
  invocation_id: z.string().min(1).max(128),
  binding_id: z.string().min(1).max(128),
  binding_digest: z.string().regex(/^[a-f0-9]{64}$/),
  command: z.enum(["pause", "commit", "resume"]),
  command_id: z.string().min(1).max(128),
  idempotency_key: z.string().min(1).max(128),
  effect: z.string().min(1).max(128),
  control_version: z.number().int().nonnegative(),
  plan_epoch: z.number().int().positive(),
  controller_epoch: z.number().int().positive(),
  gate_epoch: z.number().int().positive(),
  boundary: ContextBoundarySchema,
  revision_id: z.string().min(1).max(128).nullable(),
  preview_manifest_digest: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  approved_manifest_digest: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
}).strict();
export type ContextControlReceipt = z.infer<typeof ContextControlReceiptSchema>;
