import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { z } from "zod";
import type { ContextBinding } from "./index";

const identifier = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const version = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const ContextOwnerBindingStateSchema = z.enum([
  "available", "disabled", "unattached", "denied", "stale", "unsupported",
]);
export type ContextOwnerBindingState = z.infer<typeof ContextOwnerBindingStateSchema>;
export const ContextOwnerSourceSchema = z.object({
  source_id: identifier, version, digest,
}).strict();
export const ContextOwnerLimitsSchema = z.object({
  max_items: z.number().int().min(1).max(64),
  max_notes: z.number().int().min(0).max(16),
  max_context_bytes: z.number().int().min(1).max(131_072),
  max_objective_bytes: z.number().int().min(1).max(512),
  max_control_events: z.number().int().min(1).max(4096),
}).strict();
export const ContextOwnerContinuitySchema = z.object({
  survives_controller_restart: z.boolean(),
  receipt_recovery: z.boolean(),
  provider_session_continuity: z.boolean(),
}).strict();
export const ContextOwnerGrantsSchema = z.object({
  metadata_read: z.boolean(), content_read: z.boolean(), edit: z.boolean(), control: z.boolean(),
}).strict();
const operation = z.enum([
  "include_item", "exclude_item", "pin_item", "unpin_item", "put_note", "remove_note",
  "set_objective", "restore_configuration", "pause", "commit", "resume",
]);
const descriptorShape = z.object({
  schema_version: z.literal("ascension.context-control.owner-binding.v1"),
  binding_id: identifier, version, digest, context_ref: identifier,
  node_kinds: z.array(identifier).min(1).max(16),
  sources: z.array(ContextOwnerSourceSchema).max(16),
  operations: z.array(operation).max(16),
  effective_limits: ContextOwnerLimitsSchema,
  continuity: ContextOwnerContinuitySchema,
  grants: ContextOwnerGrantsSchema,
  state: ContextOwnerBindingStateSchema,
}).strict();
export type ContextOwnerDescriptor = z.infer<typeof descriptorShape>;

function hash(value: unknown): string {
  return bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(value))));
}

/** Rust serde struct order, including nested structs; array order is significant. */
function orderedDescriptor(d: ContextOwnerDescriptor, unsigned = false): unknown {
  return {
    schema_version: d.schema_version, binding_id: d.binding_id, version: d.version,
    digest: unsigned ? "" : d.digest, context_ref: d.context_ref, node_kinds: d.node_kinds,
    sources: d.sources.map((s) => ({ source_id: s.source_id, version: s.version, digest: s.digest })),
    operations: d.operations,
    effective_limits: {
      max_items: d.effective_limits.max_items, max_notes: d.effective_limits.max_notes,
      max_context_bytes: d.effective_limits.max_context_bytes,
      max_objective_bytes: d.effective_limits.max_objective_bytes,
      max_control_events: d.effective_limits.max_control_events,
    },
    continuity: {
      survives_controller_restart: d.continuity.survives_controller_restart,
      receipt_recovery: d.continuity.receipt_recovery,
      provider_session_continuity: d.continuity.provider_session_continuity,
    },
    grants: {
      metadata_read: d.grants.metadata_read, content_read: d.grants.content_read,
      edit: d.grants.edit, control: d.grants.control,
    },
    state: d.state,
  };
}

export const ContextOwnerDescriptorSchema = descriptorShape.superRefine((d, ctx) => {
  if (!descriptorShape.safeParse(d).success) return;
  let valid = true;
  const reject = (message: string): void => { valid = false; ctx.addIssue({ code: "custom", message }); };
  if (new Set(d.node_kinds).size !== d.node_kinds.length) reject("Duplicate node kind");
  if (new Set(d.sources.map((s) => `${s.source_id}\0${s.version}`)).size !== d.sources.length) reject("Duplicate source identity");
  if (new Set(d.operations).size !== d.operations.length) reject("Duplicate operation");
  if ((d.grants.content_read && !d.grants.metadata_read) || (d.grants.edit && !d.grants.content_read)
    || (d.grants.control && !d.grants.metadata_read)) reject("Invalid grant relation");
  if (d.state === "available" && d.grants.control && d.operations.length === 0) reject("Control requires operations");
  if (valid && hash(orderedDescriptor(d, true)) !== d.digest) reject("Descriptor digest mismatch");
});

export const ContextOwnerCatalogSchema = z.object({
  schema_version: z.literal("ascension.context-control.owner-catalog.v1"),
  owner_id: identifier, owner_version: identifier, catalog_digest: digest,
  descriptors: z.array(ContextOwnerDescriptorSchema).max(128),
}).strict().superRefine((catalog, ctx) => {
  if (catalog.descriptors.length > 128 || !identifier.safeParse(catalog.owner_id).success
    || !identifier.safeParse(catalog.owner_version).success
    || catalog.descriptors.some((d) => !ContextOwnerDescriptorSchema.safeParse(d).success)) return;
  if (new Set(catalog.descriptors.map((d) => `${d.binding_id}\0${d.version}`)).size !== catalog.descriptors.length) {
    ctx.addIssue({ code: "custom", message: "Duplicate binding identity" });
    return;
  }
  if (hash([catalog.owner_id, catalog.owner_version, catalog.descriptors.map((d) => orderedDescriptor(d))]) !== catalog.catalog_digest) {
    ctx.addIssue({ code: "custom", message: "Catalog digest mismatch" });
  }
});
export type ContextOwnerCatalog = z.infer<typeof ContextOwnerCatalogSchema>;

/** Integrity is not authentication. Only an authenticated owner response supplies authority. */
export function contextBindingsFromOwnerCatalog(catalog: ContextOwnerCatalog | undefined): ContextBinding[] | undefined {
  const admitted = ContextOwnerCatalogSchema.safeParse(catalog);
  if (!admitted.success) return undefined;
  const available = admitted.data.descriptors.filter((d) => d.state === "available");
  return available.filter((d) => d.grants.metadata_read).flatMap((d) => {
    const node_kinds = (["analyze", "decide"] as const).filter((kind) =>
      d.node_kinds.includes(kind) && available.filter((other) =>
        other.context_ref === d.context_ref && other.node_kinds.includes(kind)).length === 1);
    return node_kinds.length ? [{ context_ref: d.context_ref, node_kinds }] : [];
  });
}
