import {
  parseInferenceProfilePin,
  resolveInferenceProfile,
  type InferenceProfileCatalog,
  type InferenceProfileRejection,
} from "@studio/contracts";

import type { SemanticDocument } from "./semantic-document";

/**
 * Issue #112 T2 — immutable adoption at admission.
 *
 * A workflow node names an inference profile through a free-text reference.
 * The Studio binds that reference to an EXACT immutable identity — the
 * `profile_id:version:digest` pin the owner itself publishes — so a later
 * revision of the referenced profile cannot silently change an already
 * published or active definition.
 *
 * This module is the ADMISSION half of that binding. It answers one question
 * for every profile-bearing node in a whole document: "is this definition
 * still bound to an identity the owner currently admits?"
 *
 * Three rules make it a real immutability check rather than a re-read:
 *
 * 1. A reference that is not an exact pin is UNBOUND, never upgraded. There is
 *    no "pick the newest revision for me" path — that is exactly the silent
 *    change T2 forbids. A new revision requires an explicit re-bind.
 * 2. Every refusal the owner can publish is preserved. The check delegates to
 *    `resolveInferenceProfile`, so it can only ever refuse for a reason the
 *    owner's own resolver already refuses for. It ADDS an admission point; it
 *    never relaxes or reorders a refusal.
 * 3. No catalog means no authority. A definition cannot be admitted against a
 *    catalog the browser did not receive, because "I could not check" must not
 *    read as "it is fine".
 *
 * The accepted Phase 1 schema types these references as a plain `id`, which an
 * exact pin already satisfies. This check therefore enforces the pin
 * *semantics* on the Studio side without editing the pinned contract.
 */

/** The owner config key that carries each node kind's profile reference. */
const PROFILE_REFERENCE_KEYS: Readonly<Record<string, string>> = {
  decide: "decision_profile_ref",
  adaptive_region: "planner_profile_ref",
};

export type ProfileBindingDiagnosticCode =
  | "profile_ref_unbound"
  | "profile_pin_malformed"
  | "profile_catalog_unavailable"
  | `profile_${InferenceProfileRejection}`;

export interface ProfileBindingDiagnostic {
  graphId: string;
  nodeId: string;
  path: string;
  code: ProfileBindingDiagnosticCode;
  message: string;
}

/**
 * Operator-facing wording for each admission refusal. The reason code is
 * carried verbatim alongside the sentence so a designer can report exactly what
 * the owner said rather than a paraphrase that merges two different problems.
 */
const REJECTION_TEXT: Record<InferenceProfileRejection, string> = {
  unknown_profile: "the owner has not published this profile",
  digest_mismatch: "the pinned digest does not match the published descriptor",
  revoked: "the owner revoked this profile",
  disabled: "the owner disabled this profile",
  stale: "this revision is stale",
  unsupported: "the owner does not support this profile here",
  unsupported_node_kind: "the owner does not serve this profile for this node kind",
  selection_not_granted: "the owner did not grant this browser permission to bind it",
  context_incompatible: "the owner does not admit this profile for this node's context",
  catalog_untrusted: "the owner catalog is not trusted; no profile can be selected",
};

/**
 * Checks every profile-bearing node in `document` against `catalog`.
 *
 * `catalog` is `undefined` when the browser has no admitted owner catalog. In
 * that case the definition is reported as UNCHECKABLE rather than clean, so a
 * missing catalog can never be read as a passing admission.
 */
export function validateProfileBindings(
  document: SemanticDocument,
  catalog: InferenceProfileCatalog | undefined,
): ProfileBindingDiagnostic[] {
  const diagnostics: ProfileBindingDiagnostic[] = [];
  for (const graph of document.graphs) {
    for (const node of graph.nodes) {
      const key = PROFILE_REFERENCE_KEYS[node.kind];
      if (!key) continue;
      const path = `$.graphs.${graph.id}.nodes.${node.id}.config.${key}`;
      const raw = node.config[key];
      const reference = typeof raw === "string" ? raw : "";
      if (reference.length === 0) {
        diagnostics.push({
          graphId: graph.id,
          nodeId: node.id,
          path,
          code: "profile_ref_unbound",
          message: `${node.kind} requires ${key} to be bound to an exact inference profile identity before this definition can be admitted.`,
        });
        continue;
      }
      const selection = parseInferenceProfilePin(reference);
      if (!selection) {
        // A floating id is NOT upgraded to the newest revision here. Admitting
        // it would let a profile update silently change this definition, which
        // is precisely the mutation T2 exists to prevent.
        diagnostics.push({
          graphId: graph.id,
          nodeId: node.id,
          path,
          code: "profile_pin_malformed",
          message: `${key} is "${reference}", which is not an exact profile_id:version:digest pin. Bind an exact revision explicitly; no revision is chosen for you.`,
        });
        continue;
      }
      if (!catalog) {
        diagnostics.push({
          graphId: graph.id,
          nodeId: node.id,
          path,
          code: "profile_catalog_unavailable",
          message: `The owner inference profile catalog is unavailable, so ${key} could not be checked against a published identity. Admission fails closed until the catalog is read.`,
        });
        continue;
      }
      // Context compatibility is an owner-side admission step keyed on the
      // node's own declared `context_ref`, exactly as the designer field passes
      // it, so both surfaces judge the same binding the same way.
      const contextRef = typeof node.config.context_ref === "string" ? node.config.context_ref : undefined;
      const resolution = resolveInferenceProfile(catalog, selection, node.kind, contextRef);
      if (!resolution.ok) {
        const rejection = resolution.rejection ?? "unknown_profile";
        diagnostics.push({
          graphId: graph.id,
          nodeId: node.id,
          path,
          code: `profile_${rejection}`,
          message: `${key} is pinned to ${reference}, which the owner does not admit: ${rejection}: ${REJECTION_TEXT[rejection]}. The binding is unchanged and must be re-adopted deliberately.`,
        });
      }
    }
  }
  return diagnostics;
}
