// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { JsonObject } from "@studio/contracts";
import { importRecording } from "./import";
import type { InspectionRecord, RecordingInspection } from "./model";
import { digest, encode, jcs } from "./primitives";

// Projection digests from the Protocol owner validator at 001b89ff7fd579f2857a00accf307a77cd880431.
// Inputs: candidate3 SHA256SUMS 580c1cf3be4bb3e4eb37b9acd9166808b7386b0eb84286cc0798a0d88e35bb35.
// Independently matched the unpublished Observability owner candidate on all eight vectors.
// These are digests of the complete normalized projection, NOT bundle semantic digests.
const cases = [
  ["golden/legacy-failed.zip", "5fe3184847f46edf93c661e4b7327c81e50299b71a0787dcf20292c5b1df3a6d", "30d6a0360e65964f1b21176096f82520431d4c6a4fd8b17e63723dba1086658d"],
  ["golden/legacy-failed-deflated.zip", "8a2454078b1151603a45d24912f598e24d6f35e4a2215d7c574692e0cda7f15d", "30d6a0360e65964f1b21176096f82520431d4c6a4fd8b17e63723dba1086658d"],
  ["golden/missing-accounting.zip", "d1155e0807cc4d7a34f8b57e2cf0bafbe9618ae7eac3b7f5211e4572796e82c6", "c07f7e5bbd9a5139f56d6e63d3bf78944f212a0f1b60b2cc5a97f5fc286de359"],
  ["golden/source-partial.zip", "5687088472d122830774e8af58d62abf093ed8fec33f528cccf8dbb2583cc8d8", "c9ab9b04de26f811de28c92a7577fe6c79650aea7d18f49958860ee97b5cbe12"],
  ["golden/optional-unknown.zip", "ba3613874e528aae43eb4115ba7c341c0032537fbd770ab0ff596d73ed413cec", "83163f0f60b8873b6b8fd4e9fb8a70cb8e518f3df18ac43c40e3df15a7995fda"],
  ["golden/completed-gameplay.zip", "b15518d01aede945cbb291e45660be9c222287e8600b0c66394eb31ffe2b42c4", "67699f755e78abb06e4f99444dec01098512dcf7ba26b1c8b41099001d2aa084"],
  ["golden/optional-profile-punctuation.zip", "6a44c081c0025bbb4870efb915c0e0dde45ebbc4e39c6b3bffca86ef0065fef6", "4455225e474a50b64e36bb6f504c3070f6ea673aa33471a3cdf50b2b50f02a51"],
  ["golden/owner-identity-alias.zip", "240415dfc3b425a676ce2c680fd65ff3ee8b38e74ef90d57863c6175190d6184", "835f161d2010b8bb5c27f062fe467f37158bbedca0d3020e0620016ebaa82769"],
] as const;
const base = new URL("../../../contracts/recorded-run-candidate/", import.meta.url);

const row = (r: InspectionRecord): JsonObject => ({
  key: r.key, stream: r.stream, ordinal: r.ordinal,
  sequence: r.sequence ?? null, timestamp: r.timestamp ?? null,
  identities: r.identities, evidence: r.evidence, payload: r.payload,
});
function projection(r: RecordingInspection): JsonObject {
  const { streams: _streams, ...completeness } = r.completeness;
  const p = r.provenance;
  return {
    digest: r.digest, identity: r.bundleIdentity, identities: r.identities,
    omissions: r.omissions, completeness, evidence: r.evidence,
    provenance: {
      producer: p.producer, adapter: p.adapter, versions: p.versions,
      format_version: p.format_version, contract_schema_sha256: p.contract_schema_sha256,
      fixture_provenance: p.fixture_provenance,
    },
    events: r.records.map(row), accounting: r.accounting.map(row),
    observations: r.records.filter(x => x.payload.kind === "observation_summary").map(x => x.payload),
    counts: {
      event_records: r.records.length, accounting_records: r.accounting.length,
      unsupported_records: r.records.filter(x => x.payload.kind === "opaque").length,
      unknown_action_outcomes: r.records.filter(x => x.payload.kind === "action_outcome" && x.evidence.action === "unknown").length,
      settled_action_outcomes: r.records.filter(x => x.payload.kind === "action_outcome" && x.evidence.action === "settled").length,
    },
  };
}

describe("Protocol owner projection parity", () => {
  it("covers every accepted vector in the pinned candidate3 inventory", () => {
    const conformance = JSON.parse(readFileSync(new URL("conformance.json", base), "utf8")) as {
      cases: { path: string; valid: boolean; sha256: string }[];
    };
    expect(conformance.cases.filter(v => v.valid).map(v => [v.path, v.sha256])).toEqual(cases.map(([path, fixture]) => [path, fixture]));
  });
  it.each(cases)("preserves the complete owner projection for %s", async (path, fixture, expected) => {
    const bytes = Uint8Array.from(readFileSync(new URL(path, base)));
    expect(digest(bytes)).toBe(fixture);
    const imported = await importRecording(bytes.buffer);
    expect(digest(encode(jcs(projection(imported))))).toBe(expected);
  });
});
