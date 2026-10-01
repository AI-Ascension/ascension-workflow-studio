import { z } from "zod";
import {
  InferenceProfileBudgetsSchema,
  InferenceProfileDescriptorSchema,
  type InferenceProfileDescriptor,
} from "./inference-profile-catalog";

/** Consumer mirror of the owner contract served at
 * `POST /v1/inference-profiles/{profile_id}/revisions`.
 *
 * Producer: sts2-harness `crates/harness/src/management/inference_profile_revision.rs`
 * at `3ce3916ef61bd50670c024a087fe46562a067d27`, whose wire shape is
 * `contracts/inference-profile/revision.schema.json` at the same revision. This
 * transcribes that schema; it is not a re-design of it.
 *
 * The distinction this contract exists to enforce is the one the owner already
 * enforces producer-side: reading the catalog is `workflow:read`, adopting a
 * revision is `workflow:content:write`, and `descriptor.grants.edit` is
 * consulted independently. A profile that is readable may still be refused an
 * edit, so "the consumer could see it" never implies "the consumer may change
 * it".
 *
 * THE REQUEST IS CLOSED, AND THAT IS THE POINT. The producer states the
 * reason directly: "any field outside the editable allow-list is rejected
 * rather than ignored, so an unadvertised authority or credential field cannot
 * be smuggled through an edit that is otherwise well-formed." There is
 * deliberately no member here for an adapter, requested/resolved model, node
 * kind, operation, context compatibility, continuity, state or grant — a
 * consumer edit inherits every one of those from the revision it edits, so it
 * cannot widen a profile. `.strict()` below is therefore a security control
 * and not a stylistic choice; it is mirrored by `serde(deny_unknown_fields)`
 * and by `additionalProperties: false` in the producer schema.
 *
 * Nothing here is producer-proven by execution. No owner process, provider or
 * native game was involved in authoring this file; see
 * `inference-profile-catalog.ts` for how the catalog's own provenance is
 * established instead. */

export const INFERENCE_PROFILE_REVISION_SCHEMA_VERSION = "ascension.inference-profile-revision/v1";
export const INFERENCE_PROFILE_REVISION_RESPONSE_SCHEMA_VERSION =
  "ascension.inference-profile-revision-response/v1";

/** Producer `validate_identifier`, byte-bounded and reused rather than
 * re-invented: a looser pattern here would accept a mutation id or a profile id
 * the owner refuses, and the browser would then fail a request the owner never
 * had to consider. */
const identifier = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/).refine(
  (value) => new TextEncoder().encode(value).length <= 128,
  "identifier exceeds the 128-byte producer bound",
);

/** Producer `validate_digest`. */
const digest = z.string().regex(/^[0-9a-f]{64}$/);

/** Producer `SemanticVersion::new`, three dot-separated digit runs with no
 * empty run and no leading zero. */
const semver = z.string().regex(/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/);

/** The exact `profile_id:version:digest` a definition pins, as produced by the
 * owner's `InferenceProfileRevisionResponse::new`. Expressed as a schema rather
 * than only as documentation because this string is what a caller would
 * otherwise copy out of a response and paste into a definition unchecked. */
export const InferenceProfileReferenceSchema = z.string().regex(
  /^[A-Za-z0-9][A-Za-z0-9._:-]*:(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*):[0-9a-f]{64}$/,
);
export type InferenceProfileReference = z.infer<typeof InferenceProfileReferenceSchema>;

/** The editable allow-list, and nothing else.
 *
 * The producer derives the candidate by overriding exactly these five members
 * on a clone of the head revision:
 *
 * ```rust
 * let candidate = InferenceProfileDescriptor {
 *     version: request.version.clone(),
 *     prompt_revision: request.prompt_revision.clone(),
 *     settings_revision: request.settings_revision.clone(),
 *     supported_settings: request.supported_settings.clone(),
 *     effective_budgets: request.effective_budgets.clone(),
 *     digest: String::new(),
 *     ..head.clone()
 * }.seal()?;
 * ```
 *
 * So a member added to this schema would not widen authority — the owner
 * ignores it — but it would still be a lie to the caller about what an edit
 * can do, and it would fail closed with an opaque owner error instead of a
 * local one. Keep the two shapes identical. */
export const InferenceProfileRevisionRequestSchema = z.object({
  schema_version: z.literal(INFERENCE_PROFILE_REVISION_SCHEMA_VERSION),
  /** The compare-and-swap expectation: the digest of the served revision this
   * edit was authored against. The swap is won only if the accepted head still
   * carries it. */
  expected_revision_digest: digest,
  /** Stable caller identity, so a retried edit is replayed rather than applied
   * twice. */
  client_mutation_id: identifier,
  /** Must differ from the edited revision: a revision is keyed by
 * `(profile_id, version)`, so an accepted edit is always a genuinely new
   * identity rather than a re-seal of the revision it replaced. */
  version: semver,
  prompt_revision: identifier,
  settings_revision: identifier,
  supported_settings: z.array(identifier).max(32).refine(
    (values) => new Set(values).size === values.length,
    "Duplicate supported setting",
  ),
  effective_budgets: InferenceProfileBudgetsSchema,
}).strict();
export type InferenceProfileRevisionRequest = z.infer<typeof InferenceProfileRevisionRequestSchema>;

/** Mirrors the three admitted outcomes. `replayed` is not an error: it means
 * this exact `client_mutation_id` with this exact candidate was already
 * applied, so the recorded revision is returned again unchanged. */
export const InferenceProfileRevisionOutcomeSchema = z.enum(["adopted", "replayed", "conflict"]);
export type InferenceProfileRevisionOutcome = z.infer<typeof InferenceProfileRevisionOutcomeSchema>;

export const InferenceProfileRevisionResponseSchema = z.object({
  schema_version: z.literal(INFERENCE_PROFILE_REVISION_RESPONSE_SCHEMA_VERSION),
  outcome: InferenceProfileRevisionOutcomeSchema,
  profile_id: identifier,
  /** `profile_id:version:digest` of `revision`. On a conflict this names the
   * revision that WON, which is what makes a conflict recoverable by an
   * explicit human re-author rather than by a silent retry. */
  reference: InferenceProfileReferenceSchema,
  /** The adopted revision, or the currently accepted revision when the swap
   * was lost. The producer's own schema declares this member only as
   * `"type": "object"` and defers its closed shape to
   * `catalog.schema.json#/$defs/descriptor`, which this package already
   * transcribes; adopting that same closed shape here is what stops a
   * forged or malformed descriptor from being rendered as an adopted
   * revision. */
  revision: InferenceProfileDescriptorSchema,
}).strict().superRefine((response, ctx) => {
  if (!identifier.safeParse(response.profile_id).success
    || !InferenceProfileDescriptorSchema.safeParse(response.revision).success) {
    return;
  }
  // The owner composes `reference` as
  // `format!("{profile_id}:{}:{}", revision.version, revision.digest)`. A
  // response whose reference disagrees with its own revision is not a
  // response this owner produced, and acting on it would mean pinning a
  // reference the owner never admitted.
 const expected = `${response.profile_id}:${response.revision.version}:${response.revision.digest}`;
  if (response.reference !== expected) {
    ctx.addIssue({ code: "custom", message: "Revision reference does not name its own revision" });
  }
});
export type InferenceProfileRevisionResponse =
  z.infer<typeof InferenceProfileRevisionResponseSchema>;

/** What the caller may treat as durable after one edit attempt.
 *
 * This exists so a caller cannot reach for `response.reference` without first
 * having passed an explicit, named decision about the outcome. `adopted` and
 * `replayed` both name a revision the owner accepted, but they are NOT the same
 * event: a replay means this mutation id was already applied, so the caller
 * must not present it as a fresh adoption. `conflict` names the winner and
 * must never be applied by the caller. */
export interface InferenceProfileRevisionAdoption {
  outcome: InferenceProfileRevisionOutcome;
  profile_id: string;
  reference: InferenceProfileReference;
  revision: InferenceProfileDescriptor;
  /** True only when this response's CAS was won by this request. */
  adopted: boolean;
  /** True when the edit lost the swap to a concurrent edit. */
  conflicted: boolean;
}

export function adoptInferenceProfileRevision(
  response: InferenceProfileRevisionResponse,
): InferenceProfileRevisionAdoption {
  return {
    outcome: response.outcome,
    profile_id: response.profile_id,
    reference: response.reference,
    revision: response.revision,
    adopted: response.outcome === "adopted",
    conflicted: response.outcome === "conflict",
  };
}

/** Re-exported so a caller cannot assemble a revision edit from a looser
 * descriptor shape than the producer's own `InferenceProfileDescriptor`. */
export type { InferenceProfileDescriptor };
