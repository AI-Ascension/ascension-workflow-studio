// Synthetic mutations for adversarial tests, not additional producer provenance.
import { createHash } from "node:crypto";
import fixture from "../../../contracts/accepted/context-control/catalog-conformance.json";
import type { ContextOwnerCatalog, ContextOwnerDescriptor } from "./context-owner-catalog";

export function catalogFixture(name = "default"): ContextOwnerCatalog {
  return structuredClone(fixture.catalogs.find((row) => row.name === name)!.catalog) as ContextOwnerCatalog;
}
const order = {
  descriptor: ["schema_version", "binding_id", "version", "digest", "context_ref", "node_kinds", "sources", "operations", "effective_limits", "continuity", "grants", "state"],
  source: ["source_id", "version", "digest"],
  effective_limits: ["max_items", "max_notes", "max_context_bytes", "max_objective_bytes", "max_control_events"],
  continuity: ["survives_controller_restart", "receipt_recovery", "provider_session_continuity"],
  grants: ["metadata_read", "content_read", "edit", "control"],
};
function fields(value: object, keys: string[]): Record<string, unknown> {
  return Object.fromEntries(keys.map((key) => [key, (value as Record<string, unknown>)[key]]));
}
const hash = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function ordered(d: ContextOwnerDescriptor): Record<string, unknown> {
  const value = fields(d, order.descriptor);
  value.sources = d.sources.map((s) => fields(s, order.source));
  for (const key of ["effective_limits", "continuity", "grants"] as const) value[key] = fields(d[key], order[key]);
  return value;
}
export function reseal(catalog: ContextOwnerCatalog): ContextOwnerCatalog {
  for (const d of catalog.descriptors) d.digest = hash({ ...ordered(d), digest: "" });
  catalog.catalog_digest = hash([catalog.owner_id, catalog.owner_version, catalog.descriptors.map(ordered)]);
  return catalog;
}
