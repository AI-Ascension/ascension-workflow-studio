import {
  type JsonObject,
  type JsonValue,
  type LayoutSidecar,
  LayoutSidecarSchema,
  WorkflowDefinitionSchema,
} from "@studio/contracts";

import { diffDocuments } from "./document-edits";
import { cloneJson, isJsonRecord, sameJson, toJsonValueOrUndefined } from "./json";
import type { SemanticDocument } from "./semantic-document";

export interface MergeConflict {
  path: string;
  base: JsonValue | undefined;
  local: JsonValue | undefined;
  remote: JsonValue | undefined;
}

export interface DocumentMergeResult {
  document: SemanticDocument | undefined;
  conflicts: MergeConflict[];
  changedPaths: string[];
}

export interface LayoutMergeResult {
  layout: LayoutSidecar | undefined;
  conflicts: MergeConflict[];
}

export function mergeDocuments(
  base: SemanticDocument,
  local: SemanticDocument,
  remote: SemanticDocument,
): DocumentMergeResult {
  const conflicts: MergeConflict[] = [];
  const merged = mergeJson(base, local, remote, "$", conflicts);
  if (conflicts.length > 0) {
    return { document: undefined, conflicts, changedPaths: conflicts.map((conflict) => conflict.path) };
  }
  const parsed = WorkflowDefinitionSchema.safeParse(merged);
  if (!parsed.success) {
    return {
      document: undefined,
      conflicts: [{ path: "$", base: cloneJson(base), local: cloneJson(local), remote: cloneJson(remote) }],
      changedPaths: ["$"],
    };
  }
  return { document: parsed.data, conflicts: [], changedPaths: diffDocuments(base, parsed.data).map((change) => change.path) };
}

export function mergeLayoutSidecars(
  base: LayoutSidecar,
  local: LayoutSidecar,
  remote: LayoutSidecar,
): LayoutMergeResult {
  const conflicts: MergeConflict[] = [];
  const merged = mergeJson(base, local, remote, "$", conflicts);
  if (conflicts.length > 0) return { layout: undefined, conflicts };
  const parsed = LayoutSidecarSchema.safeParse(merged);
  return parsed.success ? { layout: parsed.data, conflicts: [] } : {
    layout: undefined,
    conflicts: [{ path: "$", base: cloneJson(base), local: cloneJson(local), remote: cloneJson(remote) }],
  };
}

function mergeJson(
  base: unknown,
  local: unknown,
  remote: unknown,
  path: string,
  conflicts: MergeConflict[],
): JsonValue | undefined {
  if (sameJson(local, base)) return toJsonValueOrUndefined(remote);
  if (sameJson(remote, base) || sameJson(local, remote)) return toJsonValueOrUndefined(local);
  if (isJsonRecord(base) && isJsonRecord(local) && isJsonRecord(remote)) {
    const output = Object.create(null) as JsonObject;
    const keys = new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)]);
    for (const key of [...keys].sort()) {
      const value = mergeJson(base[key], local[key], remote[key], `${path}.${key}`, conflicts);
      if (value !== undefined) output[key] = value;
    }
    return output;
  }
  if (Array.isArray(base) && Array.isArray(local) && Array.isArray(remote)) {
    conflicts.push({ path, base: toJsonValueOrUndefined(base), local: toJsonValueOrUndefined(local), remote: toJsonValueOrUndefined(remote) });
    return undefined;
  }
  conflicts.push({ path, base: toJsonValueOrUndefined(base), local: toJsonValueOrUndefined(local), remote: toJsonValueOrUndefined(remote) });
  return undefined;
}
