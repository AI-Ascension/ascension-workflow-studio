import type { DefinitionRecord, JsonObject, JsonValue } from "@studio/contracts";

export type SubworkflowReferenceStatus = "resolved" | "unavailable" | "version-mismatch" | "digest-mismatch";

export interface SubworkflowReferenceResolution {
  status: SubworkflowReferenceStatus;
  reference: { id: string; version: string; digest: string };
  record?: DefinitionRecord;
  digestVerified: boolean;
  message: string;
}

function text(value: JsonValue | undefined): string {
  return typeof value === "string" ? value : "";
}

/**
 * Resolves a pinned subworkflow reference by exact workflow id, version and
 * digest against the loaded definition catalog. It never falls back to a
 * floating "latest" reference and never substitutes a different consumer.
 */
export function resolveSubworkflowReference(catalog: DefinitionRecord[], config: JsonObject): SubworkflowReferenceResolution {
  const raw = config.artifact_ref;
  const object = raw !== null && typeof raw === "object" && !Array.isArray(raw) ? (raw as JsonObject) : {};
  const reference = { id: text(object.id), version: text(object.version), digest: text(object.digest) };
  if (!reference.id || !reference.version) {
    return { status: "unavailable", reference, digestVerified: false, message: "The pinned reference is incomplete; set an exact id and version." };
  }
  const byId = catalog.filter((entry) => entry.definition.workflow_id === reference.id);
  if (byId.length === 0) {
    return { status: "unavailable", reference, digestVerified: false, message: `${reference.id} is not present in the loaded catalog; refresh or review the library deliberately.` };
  }
  const exact = byId.find((entry) => entry.definition.version === reference.version);
  if (!exact) {
    return { status: "version-mismatch", reference, record: byId[0], digestVerified: false, message: `${reference.id}@${reference.version} is not admitted; the catalog only has ${byId.map((entry) => entry.definition.version).join(", ")}. No floating latest is used.` };
  }
  if (reference.digest && exact.definitionDigest) {
    return exact.definitionDigest === reference.digest
      ? { status: "resolved", reference, record: exact, digestVerified: true, message: `Resolved ${reference.id}@${reference.version} with a matching catalog digest.` }
      : { status: "digest-mismatch", reference, record: exact, digestVerified: false, message: `Resolved ${reference.id}@${reference.version}, but the pinned digest does not match the catalog digest. Fails closed until reviewed.` };
  }
  return { status: "resolved", reference, record: exact, digestVerified: false, message: `Resolved ${reference.id}@${reference.version} by exact id and version. The catalog does not publish a digest to compare.` };
}
