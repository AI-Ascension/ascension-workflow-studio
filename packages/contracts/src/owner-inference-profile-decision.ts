import { z } from "zod";

import { parseInferenceProfilePin } from "./inference-profile-catalog";

/** Consumer mirror of the owner's PUBLISHED inference-profile admission
 * decision.
 *
 * Producer: sts2-harness `crates/harness/src/management/contract_inference_profiles.rs`
 * at `a7b47ac1` (`ResolvedInferenceProfileRef`), reached from both admission
 * surfaces as `ValidateResponse.inference_profiles`
 * (`contract_commands.rs:179`) and `StudioPublishResponse.inference_profiles`
 * (`contract_authoring.rs:104`). Neither member is skipped when serialising, so
 * a NEW owner always serialises the field: `null` when it serves no
 * inference-profile catalog, a list when it does.
 *
 * WHY THIS IS A MIRROR AND NOT A SECOND ADMISSION RULE. Both owner paths now
 * resolve every `decide` / `adaptive_region` reference through the owner's own
 * served catalog with the owner's own per-node fences and publish that decision
 * here. The consumer's job is therefore to DECODE the owner's decision faithfully
 * and present it, never to re-derive one. See `ownerInferenceProfileDecision`
 * for the presentation rule, and `packages/document/src/profile-bindings.ts` for
 * the Studio-side admission check, which only ever refuses. */

/** Producer `validate_identifier`, transcribed rather than loosened.
 *
 * `graph_id`, `node_id`, `node_kind` and `profile_ref` all pass through the
 * producer's identifier gate (`workflow/id_types.rs:38`): 1..=128 bytes, ASCII
 * alphanumeric first, then ASCII alphanumeric or `. _ : -`. `profile_ref` is the
 * reference exactly as authored, so a FLOATING id is a legal value here. This
 * schema must not refuse the owner's honest report of a reference that does not
 * look pinned; immutability is established by `resolved_pin`, not by this field.
 */
const ownerIdentifier = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/).refine(
  (value) => new TextEncoder().encode(value).length <= 128,
  "identifier exceeds the 128-byte producer bound",
);

/** The producer composes the reference site path itself
 * (`inference_profile_binding.rs:188`):
 * `$.graphs[{graph_index}].nodes[{node_index}].config.{reference_field(kind)}`
 * where `reference_field` is `decision_profile_ref` for `decide` and
 * `planner_profile_ref` otherwise.
 *
 * This is a JSON path, so it is deliberately NOT held to the identifier gate
 * above: it carries `$`, `[` and `]`, none of which an owner identifier may
 * contain. Holding it to that gate would reject every well-formed owner
 * response, which is the exact failure mode this change exists to repair.
 *
 * It is bounded by the widest value the producer can emit. The field-name tail
 * is at most `planner_profile_ref` (20 bytes); the two indices are at most 4
 * decimal digits each, bounded by the producer's own `MAX_TOTAL_NODES` (1024)
 * over a definition it had to admit; and the fixed `$.graphs[` / `].nodes[` /
 * `].config.` scaffolding is 30 bytes. 256 leaves generous headroom and, like
 * the identifier bound above, is a consumer ceiling rather than a claim about
 * what the producer guarantees.
 */
const OWNER_JSON_PATH_MAX_BYTES = 256;
const ownerJsonPath = z.string().min(1).refine(
  (value) => new TextEncoder().encode(value).length <= OWNER_JSON_PATH_MAX_BYTES,
  `JSON path exceeds the ${OWNER_JSON_PATH_MAX_BYTES}-byte consumer bound`,
);

/** The bound on the published list itself.
 *
 * The producer emits at most one entry per profile-BEARING node, and both
 * surfaces resolve through `resolve_admission_inference_profiles`, which calls
 * `parse_definition` FIRST (`service_inference_profile.rs:183`). `parse_definition`
 * runs `validate_definition`, which refuses a definition whose total node count
 * exceeds `MAX_TOTAL_NODES` (1024) with `Err`, not a diagnostic
 * (`validation.rs:44`, `:80`). So a definition the owner was willing to resolve
 * over holds at most 1024 nodes and therefore publishes at most 1024 entries.
 *
 * Both owner surfaces are therefore hard-failed on an oversize definition
 * before any list is built, which is what makes this bound safe rather than
 * merely plausible: 1024 admits every list a conforming owner can publish,
 * while a longer one cannot have come from one.
 */
const OWNER_INFERENCE_PROFILES_MAX = 1024;

/** The exact `profile_id:version:digest` the owner resolved `profile_ref` to.
 *
 * Validated by REUSING `parseInferenceProfilePin`, the same codec
 * `packages/contracts/src/inference-profile-catalog.ts` already uses for the
 * designer write path, the document admission check and dispatch binding. A
 * second parser here would be a second definition of what a pin is, and the two
 * could disagree about exactly the cases that matter: a `profile_id` containing
 * `:`, which the producer's `rsplitn(3, ':')` keeps in the head.
 *
 * Reuse is what makes the refusal precise rather than incidental. The producer
 * cannot emit a pin this rejects, because it builds the value with
 * `format!("{}:{}:{}", profile_id, version, digest)` from a descriptor it has
 * already validated (`exact_pin`, `inference_profile_binding.rs:48`). So a
 * `resolved_pin` that fails to parse is a response this owner did not produce,
 * and is refused rather than displayed.
 */
const ownerExactPin = z.string().refine(
  (value) => parseInferenceProfilePin(value) !== undefined,
  "resolved_pin is not an exact profile_id:version:digest pin",
);

/** One authored inference-profile reference and the exact revision the owner
 * resolved it to.
 *
 * `.strict()` mirrors the producer's `#[serde(deny_unknown_fields)]` on
 * `ResolvedInferenceProfileRef` (`contract_inference_profiles.rs:20`). An
 * undeclared member is refused rather than ignored, so a future owner field,
 * including one carrying authority or a credential the consumer was never
 * granted, cannot ride in unparsed inside a well-formed entry.
 */
export const ResolvedInferenceProfileRefSchema = z.object({
  graph_id: ownerIdentifier,
  node_id: ownerIdentifier,
  node_kind: ownerIdentifier,
  profile_ref: ownerIdentifier,
  resolved_pin: ownerExactPin,
  path: ownerJsonPath,
}).strict();
export type ResolvedInferenceProfileRef = z.infer<typeof ResolvedInferenceProfileRefSchema>;

/** The optional owner field, shared by both admission surfaces so the two can
 * never drift on a question of authority.
 *
 * `.nullish()`, optional AND nullable, is required on both sides and is the
 * whole reason this does not become a new owner revision requirement:
 *
 * - ABSENT means this consumer is talking to an owner that predates the field.
 *   The Studio keeps decoding it, so the browser is not made to wait on a new
 *   owner revision to read a response it used to read. Nothing here is a reason
 *   to bump `contracts/live-owner-ci.lock.json`.
 * - `null` is the owner stating that it serves NO inference-profile catalog, so
 *   no profile authority was exercised.
 * - `[]` is the owner stating that it DID serve a catalog and the document
 *   carries no inference-profile reference.
 *
 * The producer documents that last distinction itself: `None` "means the owner
 * serves no inference-profile catalog, so no authority was exercised", while an
 * empty vector "means the catalog was served and the document carries no
 * inference-profile reference" (`service_inference_profile.rs:181`). These are
 * DIFFERENT facts about different owners, so the cases are kept apart and
 * neither is collapsed into the other, nor into the absent case.
 */
export const OwnerInferenceProfileDecisionSchema = z
  .array(ResolvedInferenceProfileRefSchema)
  .max(OWNER_INFERENCE_PROFILES_MAX)
  .nullish();
export type OwnerInferenceProfileDecision =
  | z.infer<typeof OwnerInferenceProfileDecisionSchema>
  | undefined;

/** What the consumer is allowed to conclude from the field's presence alone.
 *
 * This is the difference between READING a decision and MAKING one, kept as a
 * closed set so no caller can invent a fourth meaning.
 */
export type OwnerInferenceProfileDecisionKind =
  /** The owner predates the field. It published no inference-profile decision,
   * so its absence is NOT a refusal and NOT a pass. */
  | "not_published"
  /** The owner published no catalog, so no profile authority was exercised.
   * A definition cannot be admitted against a catalog nobody served. */
  | "profile_catalog_unavailable"
  /** The owner served a catalog and this document references no profile. */
  | "no_references"
  /** The owner served a catalog and published its resolution for every
   * reference it found. This is the owner's authority, reported, never
   * re-derived here. */
  | "resolved";

export interface OwnerInferenceProfileAdmission {
  kind: OwnerInferenceProfileDecisionKind;
  /** The owner's own entries, decoded and unaltered. Present only for
   * `resolved`, which is the ONLY case in which the owner states that it
   * resolved something. */
  entries?: readonly ResolvedInferenceProfileRef[];
  /** One sentence naming what the owner actually said, suitable for display.
   * Says the owner published no decision when it published none; it never
   * substitutes this side's opinion for the owner's. */
  message: string;
}

/** Classifies the owner's published decision, or reports its absence.
 *
 * This READS and LABELS. It does not resolve, repair, upgrade or infer:
 *
 * - A floating `profile_ref` is NEVER rewritten to its `resolved_pin`. The
 *   producer is explicit that `profile_ref` alone "is not an immutable
 *   identity, because a later catalog revision could resolve the same floating
 *   id to a different descriptor". Auto-upgrading the document would perform
 *   precisely the silent re-resolution the pin exists to prevent.
 * - A missing or `null` field NEVER yields a resolution. A browser that
 *   received no catalog authority must not report that the owner cleared
 *   anything.
 * - An absent field is NEVER reported as a refusal. The owner made no admission
 *   decision to report, and inventing one would fabricate owner authority.
 */
export function ownerInferenceProfileDecision(
  decision: OwnerInferenceProfileDecision,
): OwnerInferenceProfileAdmission {
  if (decision === undefined) {
    return {
      kind: "not_published",
      message: "This owner published no inference-profile decision: it predates the field, so no profile authority was exercised and none was refused.",
    };
  }
  if (decision === null) {
    return {
      kind: "profile_catalog_unavailable",
      message: "The owner serves no inference-profile catalog, so it resolved nothing and admitted no profile reference.",
    };
  }
  if (decision.length === 0) {
    return {
      kind: "no_references",
      message: "The owner served an inference-profile catalog and this document references no inference profile.",
    };
  }
  return {
    kind: "resolved",
    entries: decision,
    message: `The owner resolved ${decision.length} inference-profile reference${decision.length === 1 ? "" : "s"} to the exact revisions below. These are the owner's decisions; the document is unchanged.`,
  };
}

/** The owner-decided identity for one node, if the owner published one.
 *
 * Deliberately a LOOKUP, not a repair. A caller that wants the resolved pin must
 * still decide for itself whether to adopt it; returning `undefined` for an
 * unreferenced node is the honest answer, not a failure to fall back on to
 * something the Studio computed for itself.
 */
export function ownerResolvedPinForNode(
  decision: OwnerInferenceProfileDecision,
  graphId: string,
  nodeId: string,
): ResolvedInferenceProfileRef | undefined {
  if (!decision) return undefined;
  return decision.find((entry) => entry.graph_id === graphId && entry.node_id === nodeId);
}

/** Nodes the document references that the owner published NOTHING for, while
 * the owner did publish a decision.
 *
 * The owner's own contract says publication refuses when a reference does not
 * resolve, so a gap here means the response and the document disagree about the
 * same submission. It is REPORTED as that disagreement and never filled in: the
 * owner is the sole admission authority, so an unadmitted reference is refused,
 * not resolved by the browser.
 *
 * Returns `undefined` when there is no such gap, and also when the owner
 * published no decision at all, because "the owner said nothing" is not a
 * per-node omission.
 */
export function ownerUnresolvedProfileReferences(
  decision: OwnerInferenceProfileDecision,
  referenced: readonly { graphId: string; nodeId: string }[],
): { graphId: string; nodeId: string }[] | undefined {
  if (!decision || decision.length === 0) return undefined;
  const admitted = new Set(decision.map((entry) => `${entry.graph_id}\0${entry.node_id}`));
  const gap = referenced.filter((node) => !admitted.has(`${node.graphId}\0${node.nodeId}`));
  return gap.length > 0 ? gap : undefined;
}
