import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { z } from "zod";

/** Consumer mirror of the owner contract served at `GET /v1/inference-profiles`.
 *
 * Producer: sts2-harness `crates/harness/src/management/contract_inference_profile.rs`
 * at `3ce3916e` (schema `ascension.inference-profiles/v1` /
 * `ascension.inference-profile/v1`), pinned by
 * `contracts/accepted/inference-profile/catalog-conformance.json`.
 *
 * The fixture in that file is NOT the output of producer code running in this
 * package: no producer source is compiled, included or executed on this side.
 * Its provenance is established by the producer-linked seal instead of by a
 * replica. `contracts/inference-profile-catalog.lock.json` records
 * `sealing_method: producer_crate_linked_seal` plus the generator
 * (`tools/inference-profile-conformance-seal`), which links the pinned
 * `sts2-harness` crate as a path dependency and calls the owner's own `seal()`.
 * `tools/verify-contract-pins.mjs` then checks that the linked producer checkout
 * still hashes to the pinned source digests, that the generator binary exists,
 * and that its freshly produced output byte-equals the checked-in fixture. The
 * `producer-seal` CI job runs that gate with `--require-producer-checkout`, so
 * a missing checkout or an unbuilt binary fails the job instead of skipping
 * those checks.
 *
 * Integrity is not authentication. Only an authenticated owner response
 * supplies authority; a self-consistent digest proves nothing about who served
 * the catalog. */

/** Producer `validate_identifier`: 1..=128 BYTES, ASCII alphanumeric first,
 * then ASCII alphanumeric or `. _ : -`. Counted in bytes, not code units, so a
 * multi-byte character cannot smuggle a longer value past the bound.
 *
 * Exported so the owner's published-decision mirror decodes identifier fields
 * through THIS gate. A second verbatim transcription of a producer gate is a
 * second definition of it that the two copies could drift apart on. */
export const identifier = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/).refine(
  (value) => new TextEncoder().encode(value).length <= 128,
  "identifier exceeds the 128-byte producer bound",
);

/** Producer `validate_digest`: exactly 64 lowercase hex bytes. */
const digest = z.string().regex(/^[a-f0-9]{64}$/);

/** Producer `SemanticVersion::new`: exactly three dot-separated runs of ASCII
 * digits, none empty and none with a leading zero (`01.0.0` and `1.02.3` are
 * rejected). */
const semver = z.string().regex(/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/);

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

/** Producer `validate_budgets`: every ceiling is non-zero and bounded by the
 * producer's own constants (128 KiB in, 2,000,000 out, 10,000 calls). */
export const InferenceProfileBudgetsSchema = z.object({
  max_input_bytes: z.number().int().positive().max(131_072),
  max_output_tokens: z.number().int().positive().max(2_000_000),
  max_provider_calls: z.number().int().positive().max(10_000),
}).strict();

/** Producer declaration order, which is also the serde serialization order and
 * therefore the digest input order. Array order is significant. */
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

/** Mirrors `InferenceProfileDescriptor::seal`: clear `digest`, then serialize
 * the whole struct in declaration order, then lowercase-hex SHA-256. `unsigned`
 * performs the clear-digest half on its own so a parsed descriptor can be
 * re-hashed for comparison. */
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

/** Producer `InferenceProfileDescriptor::validate`. Bounds, identifier shape
 * and list uniqueness are checked before the digest is recomputed, exactly as
 * the owner does — "only hash after every nested field has been validated and
 * bounded". */
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

/** Producer `InferenceProfileCatalog::validate` plus `inference_catalog_digest`,
 * which hashes the JSON ARRAY `(owner_id, owner_version, descriptors)` — three
 * elements, not an object. */
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

/** Why a descriptor may not be bound to a node right now.
 *
 * The owner names each non-available state separately (`admit_state`), and this
 * consumer keeps those reasons apart rather than collapsing them: a revoked
 * profile, a stale revision and a profile this owner cannot serve are
 * different operator problems with different fixes. */
export type InferenceProfileRejection =
  | "unknown_profile"
  | "digest_mismatch"
  | "revoked"
  | "disabled"
  | "stale"
  | "unsupported"
  | "unsupported_node_kind"
  | "selection_not_granted"
  | "context_incompatible"
  | "catalog_untrusted";

export interface InferenceProfileSelection {
  profile_id: string;
  version: string;
  digest: string;
}

/** Producer `InferenceProfileRef` exact-pin format: `profile_id:major.minor.patch:<sha256>`.
 * The producer splits it with `rsplitn(3, ':')`, so the digest and version are
 * always the LAST two segments and a `profile_id` may itself contain `:`.
 *
 * This codec is the single source of truth for the Studio's exact-pin format:
 * the designer write path, the document admission check and the dispatch
 * binding all parse and render pins through it, so they cannot drift apart and
 * agree on what a "pin" means. */
export function formatInferenceProfilePin(selection: InferenceProfileSelection): string {
  return `${selection.profile_id}:${selection.version}:${selection.digest}`;
}

/** Parses an exact pin back into its three segments, or returns `undefined` for
 * a floating id or any malformed value. It never guesses a revision and never
 * falls back to a partial match: an unparseable reference is "unbound", which
 * every caller reports rather than silently repairing. */
export function parseInferenceProfilePin(reference: string): InferenceProfileSelection | undefined {
  // Split from the RIGHT, exactly as the producer's `rsplitn(3, ':')` does.
  // The head keeps every remaining colon, because `RegistryId` accepts `:`
  // after an alphanumeric first byte.
  const parts = reference.split(":");
  if (parts.length < 3) return undefined;
  const pinnedDigest = parts[parts.length - 1];
  const version = parts[parts.length - 2];
  const profileId = parts.slice(0, parts.length - 2).join(":");
  if (!identifier.safeParse(profileId).success) return undefined;
  if (!semver.safeParse(version).success) return undefined;
  if (!digest.safeParse(pinnedDigest).success) return undefined;
  return { profile_id: profileId, version, digest: pinnedDigest };
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

/** Mirrors the owner's `InferenceProfileCatalog::resolve`, including the order
 * in which it refuses: the pinned revision is located and its digest compared
 * first, then the state is admitted, then the node kind, then the `select`
 * grant. Context compatibility is a separate owner-side admission step
 * (`inference_profile_binding::admit_context`) and is applied here last, for
 * the same reason: an empty list means unconstrained.
 *
 * The two checks the producer's own `supports()` does NOT perform — the
 * `select` grant and context compatibility — are applied here, because a
 * browser may only offer a binding it is actually permitted to make.
 *
 * The owner additionally refuses a FLOATING id that matches several available
 * revisions (`inference_profile_ambiguous`). This resolver is exact-pin only:
 * it never picks a revision for the caller, so ambiguity cannot arise. */
export function resolveInferenceProfile(
  catalog: InferenceProfileCatalog | undefined,
  selection: InferenceProfileSelection,
  node_kind: string,
  context_ref?: string,
): InferenceProfileResolution {
  // A catalog that fails admission carries no authority at all. Report that
  // distinctly from "this profile is not in the catalog", which is an operator
  // action (publish a profile) rather than a transport failure.
  const admitted = InferenceProfileCatalogSchema.safeParse(catalog);
  if (!admitted.success) return { ok: false, rejection: "catalog_untrusted" };
  const match = admitted.data.descriptors.find(
    (d) => d.profile_id === selection.profile_id && d.version === selection.version,
  );
  if (!match) return { ok: false, rejection: "unknown_profile" };
  if (match.digest !== selection.digest) return { ok: false, rejection: "digest_mismatch" };
  if (match.state === "revoked") return { ok: false, rejection: "revoked" };
  if (match.state === "disabled") return { ok: false, rejection: "disabled" };
  if (match.state === "stale") return { ok: false, rejection: "stale" };
  if (match.state === "unsupported") return { ok: false, rejection: "unsupported" };
  if (!match.node_kinds.includes(node_kind)) {
    return { ok: false, rejection: "unsupported_node_kind" };
  }
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

/** Selectable descriptors for a node kind, split by whether this browser is
 * permitted to bind it. Non-selectable rows are RETAINED so a designer can
 * render why a previously bound profile stopped being servable, rather than
 * silently dropping it and leaving a dangling reference. */
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
 * The scanner is a guard against a future field addition leaking one; it is
 * paired with a positive control in the test suite so it cannot pass vacuously
 * by simply returning nothing. */
const FORBIDDEN_PROFILE_FIELDS = [
  "api_key", "apiKey", "token", "secret", "password", "credential", "credentials",
  "provider_url", "providerUrl", "endpoint", "base_url", "baseUrl", "executable",
  "command", "prompt_text", "promptText", "prompt_bytes", "allowed_operations",
] as const;

export function findCredentialBearingProfileFields(catalog: unknown): string[] {
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
