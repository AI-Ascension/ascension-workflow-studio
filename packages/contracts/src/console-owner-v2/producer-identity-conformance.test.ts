import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { decodeOwnerIdentityCorrelationV2Candidate, type UntrustedOwnerIdentityCandidateV2 } from "./identity";
import { parseBoundedJson } from "./lossless-json";
import { OwnerIdentityCandidateError, type CandidateRefusal } from "./wire-scalars";

const root = resolve(process.cwd(), "tests/fixtures/console-owner-v2-identity");
type IndexEntry = { label: string; file: string; mode: string; sha256: string };
type Fixture = {
  label: string; mode: string; input_sha256: string; input_bytes: number;
  input_base64: string; padding_spaces: number; expected_accepted: boolean;
  expected_refusal?: CandidateRefusal;
  expected_identity_u64_as_decimal_metadata?: unknown;
  producer_wire_base64?: string; producer_wire_sha256?: string;
};
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const indexes = ["index-1.json", "index-2.json"].flatMap((file) =>
  JSON.parse(readFileSync(resolve(root, file), "utf8")) as IndexEntry[]);

function fixture(entry: IndexEntry): Fixture {
  const raw = readFileSync(resolve(root, entry.file));
  expect(hash(raw)).toBe(entry.sha256);
  const value = JSON.parse(raw.toString("utf8")) as Fixture;
  expect(value.label).toBe(entry.label);
  expect(value.mode).toBe(entry.mode);
  return value;
}

function input(value: Fixture): Uint8Array {
  const prefix = Buffer.from(value.input_base64, "base64");
  expect(value.padding_spaces).toBeGreaterThanOrEqual(0);
  expect(value.input_bytes).toBeLessThanOrEqual(1_048_577);
  const bytes = new Uint8Array(prefix.length + value.padding_spaces);
  bytes.set(prefix); bytes.fill(0x20, prefix.length);
  expect(bytes.length).toBe(value.input_bytes);
  expect(hash(bytes)).toBe(value.input_sha256);
  return bytes;
}

function normalized(candidate: UntrustedOwnerIdentityCandidateV2): unknown {
  const value = candidate.identity;
  return {
    console: { ...value.console, grant_generation: value.console.grant_generation.toString(),
      grant_expires_at: value.console.grant_expires_at.toString() },
    console_scope: { ...value.console_scope },
    harness: { ...value.harness, credential_expires_at: value.harness.credential_expires_at.toString() },
  };
}

describe("pinned Console production identity producer conformance", () => {
  for (const entry of indexes.filter((row) => row.mode === "identity")) {
    it(entry.label, () => {
      const vector = fixture(entry);
      const bytes = input(vector);
      if (vector.expected_accepted) {
        const candidate = decodeOwnerIdentityCorrelationV2Candidate(bytes);
        expect(candidate.kind).toBe("untrusted_owner_identity_correlation_v2");
        expect(candidate.trust).toBe("untrusted");
        expect(candidate.authority).toBe("none");
        expect(normalized(candidate)).toEqual(vector.expected_identity_u64_as_decimal_metadata);
        const wire = Buffer.from(vector.producer_wire_base64!, "base64");
        expect(hash(wire)).toBe(vector.producer_wire_sha256);
        expect(normalized(decodeOwnerIdentityCorrelationV2Candidate(wire)))
          .toEqual(vector.expected_identity_u64_as_decimal_metadata);
      } else {
        let error: unknown;
        try { decodeOwnerIdentityCorrelationV2Candidate(bytes); } catch (caught) { error = caught; }
        expect(error).toBeInstanceOf(OwnerIdentityCandidateError);
        expect((error as OwnerIdentityCandidateError).refusal).toEqual(vector.expected_refusal);
      }
    });
  }
});

describe("pinned Console JSON depth boundary observations", () => {
  for (const entry of indexes.filter((row) => row.label === "shape-depth32" || row.label === "shape-depth33")) {
    it(entry.label, () => {
      const vector = fixture(entry);
      const bytes = input(vector);
      if (vector.expected_accepted) expect(parseBoundedJson(bytes).nodeCount).toBe(32);
      else {
        let error: unknown;
        try { parseBoundedJson(bytes); } catch (caught) { error = caught; }
        expect(error).toBeInstanceOf(OwnerIdentityCandidateError);
        expect((error as OwnerIdentityCandidateError).refusal).toEqual(vector.expected_refusal);
      }
    });
  }
});

// The remaining recorded generic floating-range observation is not identity conformance:
// this candidate retains raw generic numeric tokens and does not implement a Rust f64 visitor.
