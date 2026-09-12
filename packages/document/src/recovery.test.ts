import { describe, expect, it } from "vitest";

import { buildRecoveryRecord, isExpired, pruneRecords, recoverableFor, recoveryKey, recordBytes, RecoveryRecordSchema } from "./recovery";

const document = {
  schema_version: "ascension.workflow/v1", workflow_id: "recovery.test", version: "1.0.0", mode: "strict", game_profile: "test", policy_ref: "test.policy",
  capabilities: { required: [], optional: [] }, limits: { max_steps: 4, max_subworkflow_depth: 1, max_provider_calls: 0, max_parallel_analyses: 1, max_output_tokens: 128 }, entry_graph: "main",
  graphs: [{ id: "main", entry_node: "start", nodes: [{ id: "start", kind: "terminal", config: { outcome: "completed" } }], edges: [] }],
};
const layout = { schemaVersion: "ascension.studio-layout/v1", semanticDigest: "pending", positions: { "main:start": { x: 0, y: 0 } } };

describe("crash-recovery records", () => {
  it("stores only allow-listed sanitized authoring data", () => {
    const record = buildRecoveryRecord({ principal: "profile:studio", workspace: "studio", definitionId: "def-1", draftId: "draft.def-1", document, layout, rawText: "{}", now: 1000 });
    expect(RecoveryRecordSchema.safeParse(record).success).toBe(true);
    expect(Object.keys(record).sort()).toEqual(["definition_id", "document", "draft_id", "expires_at", "key", "layout", "principal", "raw_text", "saved_at", "schema_version", "workspace"]);
    for (const forbidden of ["token", "authorization", "credential", "command", "run_snapshot", "provider_output"]) {
      expect(Object.keys(record)).not.toContain(forbidden);
    }
  });

  it("binds records to a principal and workspace", () => {
    const record = buildRecoveryRecord({ principal: "profile:a", workspace: "studio", definitionId: "def-1", draftId: "draft.def-1", document, layout, now: 1000 });
    expect(recoveryKey("profile:a", "studio", "def-1")).toBe(record.key);
    expect(recoverableFor([record], "profile:a", "studio", "def-1", 2000)?.key).toBe(record.key);
    expect(recoverableFor([record], "profile:b", "studio", "def-1", 2000)).toBeUndefined();
    expect(recoverableFor([record], "profile:a", "other", "def-1", 2000)).toBeUndefined();
  });

  it("honours the TTL", () => {
    const record = buildRecoveryRecord({ principal: "profile:a", workspace: "studio", definitionId: "def-1", draftId: "draft.def-1", document, layout, now: 1000, ttlMs: 500 });
    expect(isExpired(record, 2000)).toBe(true);
    expect(recoverableFor([record], "profile:a", "studio", "def-1", 2000)).toBeUndefined();
    expect(recoverableFor([record], "profile:a", "studio", "def-1", 1200)?.key).toBe(record.key);
  });

  it("prunes expired records and respects the count budget keeping the newest", () => {
    const records = [1, 2, 3].map((index) => buildRecoveryRecord({ principal: "profile:a", workspace: "studio", definitionId: `def-${index}`, draftId: `draft.${index}`, document, layout, now: 1000 * index, ttlMs: 100000 }));
    const kept = pruneRecords(records, 3500, 2, 10_000_000);
    expect(kept.map((record) => record.definition_id)).toEqual(["def-3", "def-2"]);
  });

  it("prunes by byte budget", () => {
    const first = buildRecoveryRecord({ principal: "profile:a", workspace: "studio", definitionId: "old", draftId: "draft.old", document, layout, now: 1000 });
    const second = buildRecoveryRecord({ principal: "profile:a", workspace: "studio", definitionId: "new", draftId: "draft.new", document, layout, now: 2000 });
    const kept = pruneRecords([first, second], 2500, 8, recordBytes(second) + 8);
    expect(kept.map((record) => record.definition_id)).toEqual(["new"]);
  });
});
