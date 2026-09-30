// A hand-written JavaScript replica of the producer's seal, used only to build
// adversarial cases in the test file. These are NOT producer provenance: no
// producer code is compiled, included or executed here. Everything produced
// below is a deliberate tamper that the consumer is expected to refuse.
import { createHash } from "node:crypto";
import fixture from "../../../contracts/accepted/inference-profile/catalog-conformance.json" with { type: "json" };
import type { InferenceProfileCatalog, InferenceProfileDescriptor } from "./inference-profile-catalog";

export function catalogFixture(name = "synthetic"): InferenceProfileCatalog {
  return structuredClone(fixture.catalogs.find((row) => row.name === name)!.catalog) as InferenceProfileCatalog;
}

/** The producer's declaration order at the pinned revision. Exported so the
 * contract-pin gate can deep-equal it against the order recorded in
 * `contracts/inference-profile-catalog.lock.json`: that comparison is the only
 * thing making "this replica matches the owner's declared byte order" a
 * checked fact rather than a comment. Keep it byte-identical to
 * `struct InferenceProfileDescriptor` — do not reorder to match the fixture
 * file, whose on-disk keys are alphabetical and would produce a wrong digest. */
export const order = {
  descriptor: [
    "schema_version", "profile_id", "version", "digest", "adapter", "requested_model",
    "resolved_model", "prompt_revision", "settings_revision", "supported_settings",
    "operations", "node_kinds", "context_compatibility", "continuity",
    "effective_budgets", "grants", "state",
  ],
  continuity: ["provider_session_continuity", "survives_controller_restart"],
  effective_budgets: ["max_input_bytes", "max_output_tokens", "max_provider_calls"],
  grants: ["select", "edit"],
};

function fields(value: object, keys: string[]): Record<string, unknown> {
  return Object.fromEntries(keys.map((key) => [key, (value as Record<string, unknown>)[key]]));
}

const hash = (value: unknown): string =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

function ordered(d: InferenceProfileDescriptor): Record<string, unknown> {
  const value = fields(d, order.descriptor);
  for (const key of ["continuity", "effective_budgets", "grants"] as const) {
    value[key] = fields(d[key], order[key]);
  }
  return value;
}

/** Re-runs the producer's seal algorithm so a tampered catalog is internally
 * CONSISTENT again. Used to isolate "the digest check" from "the catalog is
 * simply malformed": without this, a reseal would be refused for an unrelated
 * reason and the digest assertion would prove nothing. */
export function reseal(catalog: InferenceProfileCatalog): InferenceProfileCatalog {
  for (const descriptor of catalog.descriptors) {
    descriptor.digest = hash({ ...ordered(descriptor), digest: "" });
  }
  catalog.catalog_digest = hash([
    catalog.owner_id,
    catalog.owner_version,
    catalog.descriptors.map(ordered),
  ]);
  return catalog;
}
