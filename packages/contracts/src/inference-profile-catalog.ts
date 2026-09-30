import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { z } from "zod";

/** Producer: sts2-harness `crates/harness/src/management/contract_inference_profile.rs`
 * (`be5149a3`). Mirrors `ascension.inference-profiles/v1` byte-for-byte so a
 * catalog sealed by the owner validates here without re-encoding. */
const identifier = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const semver = z.string().regex(/^\d+\.\d+\.\d+$/);

export const InferenceProfileStateSchema = z.enum([
  "available", "disabled", "revoked", "stale", "unsupported",
]);
export type InferenceProfileState = z.infer<typeof InferenceProfileStateSchema>;

/** Selection and edit are separate permissions, exactly as the owner publishes
 * them. `edit` is published so a consumer can render a capability-driven
 * unavailable state rather than hiding the profile. */
export const InferenceProfileGrantsSchema = z.object({
  select: z.boolean(),
  edit: z.boolean(),
}).strict();

export const InferenceProfileContinuitySchema = z.object({
  provider_session_continuity: z.boolean(),
  survives_controller_restart: z.boolean(),
}).strict();

export const InferenceProfileBudgetsSchema = z.object({
  max_input_bytes: z.number().int().positive().max(131_072),
  max_output_tokens: z.number().int().positive().max(2_000_000),
  max_provider_calls: z.number().int().positive().max(10_000),
}).strict();

const descriptorShape = z.object({
  schema_version: z.literal("ascension.inference-profile/v1"),
  profile_id: identifier,
  version: semver,
  digest,
  adapter: identifier,
  requested_model: identifier,
  /** `null` is the honest value while the owner has not observed an effective
 * model. It is never inferred from `requested_model`. */
  resolved_model: identifier.nullable(),
  prompt_revision: identifier,
  settings_revision: identifier,
  supported_settings: z.array(identifier).max(32),
  operations: z.array(identifier).max(32),
  node_kinds: z.array(identifier).min(1).max(8),
  /** Empty means unconstrained. */
  context_compatibility: z.array(identifier).max(32),
  continuity: InferenceProfileContinuitySchema,
  effective_budgets: InferenceProfileBudgetsSchema,
  grants: InferenceProfileGrantsSchema,
  state: InferenceProfileStateSchema,
}).strict();
export type InferenceProfileDescriptor = z.infer<typeof descriptorShape>;

function hash(value: unknown): string {
  return bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(value))));
}

/** Rust serde struct order, including nested structs; array order is
 * significant. `unsigned` zeroes `digest` for the seal-then-compare step. */
function orderedDescriptor(d: InferenceProfileDescriptor, unsigned = false): unknown {
  return {
    schema_version: d.schema_version, profile_id: d.profile_id, version: d.version,
    digest: unsigned ? "" : d.digest, adapter: d.adapter,
    requested_model: d.requested_model, resolved_model: d.resolved_model,
    prompt_revision: d.prompt_revision, settings_revision: d.settings_revision,
    supported_settings: d.supported_settings, operations: d.operations,
    node_kinds: d.node_kinds, context_compatibility: d.context_compatibility,
    continuity: {
      provider_session_continuity: d.continuity.provider_session_continuity,
      survives_controller_restart: d.continuity.survives_controller_restart,
    },
    effective_budgets: {
      max_input_bytes: d.effective_budgets.max_input_bytes,
      max_output_tokens: d.effective_budgets.max_output_tokens,
      max_provider_calls: d.effective_budgets.max_provider_calls,
    },
    grants: { select: d.grants.select, edit: d.grants.edit },
    state: d.state,
  };
}

export const InferenceProfileDescriptorSchema = descriptorShape.superRefine((d, ctx) => {
  if (!descriptorShape.safeParse(d).success) return;
  const reject = (message: string): void => {
    ctx.addIssue({ code: "custom", message });
  };
  if (new Set(d.node_kinds).size !== d.node_kinds.length) reject("Duplicate node kind");
  if (new Set(d.operations).size !== d.operations.length) reject("Duplicate operation");
  if (new Set(d.supported_settings).size !== d.supported_settings.length) {
    reject("Duplicate supported setting");
  }
  if (new Set(d.context_compatibility).size !== d.context_compatibility.length) {
    reject("Duplicate context compatibility entry");
  }
  if (hash(orderedDescriptor(d, true)) !== d.digest) reject("Descriptor digest mismatch");
});

export const InferenceProfileCatalogSchema = z.object({
  schema_version: z.literal("ascension.inference-profiles/v1"),
  owner_id: identifier,
  owner_version: identifier,
  catalog_digest: digest,
  descriptors: z.array(InferenceProfileDescriptorSchema).max(64),
}).strict().superRefine((catalog, ctx) => {
  if (!identifier.safeParse(catalog.owner_id).success
    || !identifier.safeParse(catalog.owner_version).success
    || catalog.descriptors.some((d) => !InferenceProfileDescriptorSchema.safeParse(d).success)) {
    return;
  }
  if (new Set(catalog.descriptors.map((d) => `${d.profile_id}\0${d.version}`)).size
    !== catalog.descriptors.length) {
    ctx.addIssue({ code: "custom", message: "Duplicate profile identity" });
    return;
  }
  // Producer hashes the 3-tuple `(owner_id, owner_version, descriptors)`.
  const expected = hash([
    catalog.owner_id,
    catalog.owner_version,
    catalog.descriptors.map((descriptor) => orderedDescriptor(descriptor)),
  ]);
  if (expected !== catalog.catalog_digest) {
    ctx.addIssue({ code: "custom", message: "Catalog digest mismatch" });
  }
});
export type InferenceProfileCatalog = z.infer<typeof InferenceProfileCatalogSchema>;

/** Why a descriptor may not be bound to a node right now. Anything other than
 * `available` is discoverable metadata, never a binding — mirroring the
 * owner's own `supports()`. */
export type InferenceProfileRejection =
  | "unknown_profile"
  | "unsupported_node_kind"
  | "not_available"
  | "selection_not_granted"
  | "context_incompatible"
  | "stale_binding";

export interface InferenceProfileSelection {
  profile_id: string;
  version: string;
  digest: string;
}

export interface InferenceProfileResolution {
  ok: boolean;
  selection?: InferenceProfileSelection;
  /** Requested versus resolved are reported separately and never merged. */
  requested_model?: string;
  resolved_model?: string | null;
  adapter?: string;
  prompt_revision?: string;
  settings_revision?: string;
  rejection?: InferenceProfileRejection;
  /** Bounded operations the owner published for this profile. */
  operations?: readonly string[];
  continuity?: InferenceProfileDescriptor["continuity"];
  effective_budgets?: InferenceProfileDescriptor["effective_budgets"];
}

/** Mirrors the owner's `supports()` plus the consumer-side grant and context
 * checks the browser must apply before it can offer a binding.
 *
 * A digest that does not match the sealed descriptor is `stale_binding`: the
 * referenced revision is no longer the one the owner would serve, and the
 * consumer must refuse rather than silently re-resolve. */
export function resolveInferenceProfile(
  catalog: InferenceProfileCatalog | undefined,
  selection: InferenceProfileSelection,
  node_kind: string,
  context_ref?: string,
): InferenceProfileResolution {
  const admitted = InferenceProfileCatalogSchema.safeParse(catalog);
  if (!admitted.success) {
    return { ok: false, rejection: "unknown_profile" };
  }
  const match = admitted.data.descriptors.find(
    (d) => d.profile_id === selection.profile_id && d.version === selection.version,
  );
  if (!match) return { ok: false, rejection: "unknown_profile" };
  if (match.digest !== selection.digest) return { ok: false, rejection: "stale_binding" };
  if (!match.node_kinds.includes(node_kind)) {
    return { ok: false, rejection: "unsupported_node_kind" };
  }
  if (match.state !== "available") return { ok: false, rejection: "not_available" };
  if (!match.grants.select) return { ok: false, rejection: "selection_not_granted" };
  if (context_ref !== undefined && match.context_compatibility.length > 0
    && !match.context_compatibility.includes(context_ref)) {
    return { ok: false, rejection: "context_incompatible" };
  }
  return {
    ok: true,
    selection: { profile_id: match.profile_id, version: match.version, digest: match.digest },
    requested_model: match.requested_model,
    resolved_model: match.resolved_model,
    adapter: match.adapter,
    prompt_revision: match.prompt_revision,
    settings_revision: match.settings_revision,
    operations: match.operations,
    continuity: match.continuity,
    effective_budgets: match.effective_budgets,
  };
}

/** Selectable descriptors for a node kind, split by whether the browser is
 * permitted to edit the revision. Non-`available` rows are retained so the
 * designer can render why a bound profile stopped being servable. */
export function inferenceProfilesForNodeKind(
  catalog: InferenceProfileCatalog | undefined,
  node_kind: string,
): { selectable: InferenceProfileDescriptor[]; uneditable: InferenceProfileDescriptor[] } {
  const admitted = InferenceProfileCatalogSchema.safeParse(catalog);
  if (!admitted.success) return { selectable: [], uneditable: [] };
  const candidates = admitted.data.descriptors.filter((d) => d.node_kinds.includes(node_kind));
  return {
    selectable: candidates.filter((d) => d.state === "available" && d.grants.select),
    uneditable: candidates.filter((d) => !(d.state === "available" && d.grants.select)),
  };
}

/** This contract publishes no credential, endpoint, executable or prompt byte.
 * Assert that here so a future field addition cannot leak one silently. */
const FORBIDDEN_PROFILE_FIELDS = [
  "api_key", "apiKey", "token", "secret", "password", "credential", "credentials",
  "provider_url", "providerUrl", "endpoint", "base_url", "baseUrl", "executable",
  "command", "prompt_text", "promptText", "prompt_bytes", "allowed_operations",
] as const;

export function findCredentialBearingProfileFields(
  catalog: unknown,
): string[] {
  const seen = new Set<string>();
  const walk = (value: unknown, path: string): void => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, `${path}[${index}]`));
      return;
    }
    if (typeof value !== "object" || value === null) return;
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const next = path ? `${path}.${key}` : key;
      if ((FORBIDDEN_PROFILE_FIELDS as readonly string[]).includes(key)) seen.add(next);
      walk(child, next);
    }
  };
  walk(catalog, "");
  return [...seen].sort();
}
