import { z } from "zod";

import { LayoutSidecarSchema, WorkflowDefinitionSchema } from "@studio/contracts";

export const RECOVERY_SCHEMA_VERSION = "ascension.studio-recovery/v1";
export const RECOVERY_TTL_MS = 24 * 60 * 60 * 1000;
export const RECOVERY_MAX_RECORDS = 8;
export const RECOVERY_MAX_BYTES = 512 * 1024;

/**
 * Sanitized crash-recovery record. Only authoring data is persisted. Tokens,
 * live run snapshots, provider outputs and browser commands are never stored.
 */
export const RecoveryRecordSchema = z.object({
  schema_version: z.literal(RECOVERY_SCHEMA_VERSION),
  key: z.string().min(1).max(512),
  principal: z.string().min(1).max(128),
  workspace: z.string().min(1).max(128),
  definition_id: z.string().min(1).max(128),
  draft_id: z.string().min(1).max(128),
  saved_at: z.string(),
  expires_at: z.string(),
  document: WorkflowDefinitionSchema,
  layout: LayoutSidecarSchema,
  raw_text: z.string().max(256 * 1024).optional(),
}).strict();
export type RecoveryRecord = z.infer<typeof RecoveryRecordSchema>;

export interface RecoveryRecordInput {
  principal: string;
  workspace: string;
  definitionId: string;
  draftId: string;
  document: unknown;
  layout: unknown;
  rawText?: string;
  now?: number;
  ttlMs?: number;
}

export function recoveryKey(principal: string, workspace: string, definitionId: string): string {
  return `${principal}\u0000${workspace}\u0000${definitionId}`;
}

/** Builds a sanitized record by construction: only allow-listed fields are written. */
export function buildRecoveryRecord(input: RecoveryRecordInput): RecoveryRecord {
  const now = input.now ?? Date.now();
  return RecoveryRecordSchema.parse({
    schema_version: RECOVERY_SCHEMA_VERSION,
    key: recoveryKey(input.principal, input.workspace, input.definitionId),
    principal: input.principal,
    workspace: input.workspace,
    definition_id: input.definitionId,
    draft_id: input.draftId,
    saved_at: new Date(now).toISOString(),
    expires_at: new Date(now + (input.ttlMs ?? RECOVERY_TTL_MS)).toISOString(),
    document: input.document,
    layout: input.layout,
    raw_text: input.rawText,
  });
}

export function isExpired(record: RecoveryRecord, now = Date.now()): boolean {
  return Date.parse(record.expires_at) <= now;
}

export function boundTo(record: RecoveryRecord, principal: string, workspace: string): boolean {
  return record.principal === principal && record.workspace === workspace;
}

/** Newest, unexpired record for this exact principal/workspace/definition, or undefined. */
export function recoverableFor(records: RecoveryRecord[], principal: string, workspace: string, definitionId: string, now = Date.now()): RecoveryRecord | undefined {
  return records
    .filter((record) => record.principal === principal && record.workspace === workspace && record.definition_id === definitionId && !isExpired(record, now))
    .sort((left, right) => Date.parse(right.saved_at) - Date.parse(left.saved_at))[0];
}

export function recordBytes(record: RecoveryRecord): number {
  return new TextEncoder().encode(JSON.stringify(record)).length;
}

/** Drops expired records and keeps the newest records within count and byte budgets. */
export function pruneRecords(records: RecoveryRecord[], now = Date.now(), maxRecords = RECOVERY_MAX_RECORDS, maxBytes = RECOVERY_MAX_BYTES): RecoveryRecord[] {
  const live = records.filter((record) => !isExpired(record, now)).sort((left, right) => Date.parse(right.saved_at) - Date.parse(left.saved_at));
  const kept: RecoveryRecord[] = [];
  let bytes = 0;
  for (const record of live) {
    const size = recordBytes(record);
    if (kept.length >= maxRecords || bytes + size > maxBytes) continue;
    kept.push(record);
    bytes += size;
  }
  return kept;
}

export class RecoveryQuotaError extends Error {
  public constructor(message = "Local crash-recovery storage is full.") {
    super(message);
    this.name = "RecoveryQuotaError";
  }
}

export function isQuotaError(error: unknown): boolean {
  return error instanceof Error && (error.name === "QuotaExceededError" || error.name === "RecoveryQuotaError");
}
