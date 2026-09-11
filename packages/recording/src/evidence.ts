import type { JsonObject, JsonValue } from "@studio/contracts";
import { jcs, requireImport } from "./primitives";

export const COMMON = "ai-ascension.recorded-run.common.v1";
export const STS2 = "ai-ascension.sts2.seed-readiness.v1";
export const obj = (value: JsonValue): JsonObject => value as JsonObject;
export const unknownEvidence = (): JsonObject => ({ process_exit: "unknown", request: "unknown", action: "unknown", outcome: "unknown", gameplay: "unknown" });
const check = (condition: unknown, message: string) => requireImport(condition, "evidence_mismatch", message);

export function validateEvidence(record: JsonObject, manifest: JsonObject): void {
  const payload = obj(record.payload), value = obj(payload.value), identities = obj(record.identities);
  const kind = payload.kind;
  const expected = unknownEvidence();
  if (payload.profile === COMMON && kind === "gameplay_result") {
    check(obj(manifest.producer).source_format !== "seed-readiness-controller-release-v2", "Legacy seed-readiness recordings cannot claim completed gameplay.");
    expected.gameplay = "completed"; expected.outcome = "observed";
  } else if (payload.profile !== STS2) {
    check(payload.profile !== COMMON && (manifest.optional_profiles as string[]).includes(payload.profile as string) && kind === "opaque", "Unknown profiles must be optional, inert opaque records.");
  } else {
    check(kind !== "opaque", "Known STS2 payloads must use their admitted type.");
    if (kind === "process_result") expected.process_exit = value.exit_code === 0 ? "completed" : "failed";
    if (kind === "diagnostic" && value.code === "episode_failed") expected.gameplay = "episode_failed";
    if (kind === "seed_start") {
      expected.action = value.status;
      if (value.status === "accepted" || value.status === "settled") expected.request = "accepted";
      if (value.status === "rejected") expected.request = "rejected";
      if (value.status === "settled") {
        check(value.run_started && value.host_ready && value.effect_kind === "run_started" && identities.operation, "Settled seed start requires host observation, run-start witness and operation identity.");
        expected.outcome = "observed";
      } else check(value.effect_kind === "unknown" && value.run_started === false, "Unsettled seed start cannot assert a run-start witness.");
      check(value.seed_match === (value.requested_seed_digest === value.canonical_seed_digest), "Seed match contradicts seed digests.");
    }
    if (kind === "action_outcome") check(value.status === "unknown" && !value.observation && !value.from_generation && !value.to_generation && !value.effect_digest, "Candidate legacy action receipts support only an unknown outcome.");
    if (kind === "accounting") {
      check(obj(record.source).stream === "provider-accounting", "Accounting must use its owning source stream.");
      for (const metric of Object.values(obj(value.usage))) {
        const usage = obj(metric);
        check(["unknown", "not_applicable"].includes(usage.value_status as string) === (usage.value === null), "Unknown usage must be null; numeric usage requires a stated value status.");
      }
      const counts = obj(value.counts);
      if (counts.completed_turn_count !== undefined && counts.turn_count !== undefined) check(BigInt(counts.completed_turn_count as string) <= BigInt(counts.turn_count as string), "Completed turn count exceeds total turns.");
    }
    for (const [role, namespace] of [["action", "ai-ascension.action.sha256"], ["provider_request", "ai-ascension.provider-request.sha256"]]) {
      if (identities[role]) { const identity = obj(identities[role]); check(identity.namespace === namespace && /^[a-f0-9]{64}$/.test(identity.value as string), "Sensitive identity must use its admitted digest namespace."); }
    }
    if (identities.model_execution) check(obj(identities.model_execution).namespace === (kind === "accounting" ? "seed-readiness.accounting.model-execution" : "seed-readiness.trajectory.model-execution"), "Model-execution identity is in the wrong source namespace.");
  }
  check(jcs(expected) === jcs(record.evidence), "Record evidence contradicts its admitted payload.");
}

export function validateSummary(manifest: JsonObject, report: JsonObject, records: JsonObject[]): void {
  const evidence = unknownEvidence();
  const exits = records.filter(record => obj(record.payload).kind === "process_result");
  check(exits.length <= 1, "Recording contains duplicate process results.");
  if (exits.length) evidence.process_exit = obj(exits[0].evidence).process_exit;
  if (records.some(record => obj(record.payload).kind === "diagnostic" && obj(obj(record.payload).value).code === "episode_failed")) evidence.gameplay = "episode_failed";
  if (records.some(record => obj(record.payload).kind === "gameplay_result")) {
    check(evidence.gameplay !== "episode_failed", "Gameplay evidence conflicts.");
    evidence.gameplay = "completed"; evidence.outcome = "observed";
  }
  check(jcs(evidence) === jcs(manifest.evidence), "Recording summary contradicts the record evidence.");
  if (obj(manifest.completeness).status === "complete") check(obj(manifest.completeness).source_snapshot === "stable" && (report.streams as JsonObject[]).every(stream => !["unknown", "interrupted", "unsupported"].includes(stream.state as string) && stream.rejected_rows === 0 && stream.unsupported_rows === 0), "Complete recording claim lacks a stable, reconciled source snapshot.");
}
