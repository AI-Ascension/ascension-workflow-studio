import { describe, expect, it } from "vitest";
import { decodeContextBoundaryV2Candidate } from "./boundary";
import { OwnerIdentityCandidateError, type CandidateRefusal } from "./wire-scalars";

type RawFields = Record<string, string>;

const quote = (value: string) => JSON.stringify(value);
const encoder = new TextEncoder();
const identifierFields = ["run_id", "episode_id", "agent_id", "state_id", "adapter_revision", "model_revision"] as const;
const digestFields = [
  ["observation_sha256", "boundary_observation_sha256"],
  ["catalog_sha256", "boundary_catalog_sha256"],
  ["configuration_sha256", "boundary_configuration_sha256"],
  ["output_schema_sha256", "boundary_output_schema_sha256"],
] as const;
const epochFields = ["generation", "controller_epoch", "gate_epoch", "control_version"] as const;
const boundaryFields = [
  ...identifierFields.slice(0, 4),
  "generation",
  "observation_sha256",
  "catalog_sha256",
  "adapter_revision",
  "model_revision",
  "configuration_sha256",
  "output_schema_sha256",
  "controller_epoch",
  "gate_epoch",
  "control_version",
] as const;

function defaults(): RawFields {
  return {
    run_id: quote("run-1"),
    episode_id: quote("episode-1"),
    agent_id: quote("agent-1"),
    state_id: quote("state-1"),
    generation: "1",
    observation_sha256: quote("a".repeat(64)),
    catalog_sha256: quote("b".repeat(64)),
    adapter_revision: quote("adapter-1"),
    model_revision: quote("model-1"),
    configuration_sha256: quote("c".repeat(64)),
    output_schema_sha256: quote("d".repeat(64)),
    controller_epoch: "2",
    gate_epoch: "3",
    control_version: "4",
  };
}

function object(fields: RawFields): string {
  return `{${Object.entries(fields).map(([key, value]) => `${quote(key)}:${value}`).join(",")}}`;
}

function boundaryJson(overrides: RawFields = {}, omitted: readonly string[] = []): string {
  const fields = { ...defaults(), ...overrides };
  for (const key of omitted) delete fields[key];
  return object(fields);
}

function bytes(text: string): Uint8Array {
  return encoder.encode(text);
}

function caught(input: string | Uint8Array): unknown {
  try {
    decodeContextBoundaryV2Candidate(typeof input === "string" ? bytes(input) : input);
  } catch (error) {
    return error;
  }
  throw new Error("expected context boundary refusal");
}

function refusal(input: string | Uint8Array): CandidateRefusal {
  const error = caught(input);
  if (error instanceof OwnerIdentityCandidateError) return error.refusal;
  throw error;
}

function expectJsonRefusal(input: string | Uint8Array): void {
  expect(refusal(input)).toEqual({ kind: "json_decoding" });
}

describe("Console ContextBoundary candidate", () => {
  it("decodes all fourteen exact fields into a deeply frozen untrusted candidate", () => {
    const result = decodeContextBoundaryV2Candidate(bytes(boundaryJson()));
    expect(result.kind).toBe("untrusted_context_boundary_v2");
    expect(result.trust).toBe("untrusted");
    expect(result.authority).toBe("none");
    expect(Object.keys(result)).toEqual(["kind", "trust", "authority", "boundary"]);
    expect(Object.keys(result.boundary)).toEqual(boundaryFields);
    expect(result.boundary.run_id).toBe("run-1");
    expect(result.boundary.observation_sha256).toBe("a".repeat(64));
    expect(result.boundary.generation).toBe(1n);
    expect(result.boundary.controller_epoch).toBe(2n);
    expect(result.boundary.gate_epoch).toBe(3n);
    expect(result.boundary.control_version).toBe(4n);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.boundary)).toBe(true);
  });

  it("requires each field and rejects unknown fields including schema_version", () => {
    for (const field of boundaryFields) expectJsonRefusal(boundaryJson({}, [field]));
    expectJsonRefusal(boundaryJson({ schema_version: quote("context-boundary.v1") }));
    expectJsonRefusal(boundaryJson({ unexpected: "true" }));
  });

  it("rejects the wrong JSON type at every field before semantic validation", () => {
    const numericFields: readonly string[] = epochFields;
    for (const field of boundaryFields) {
      const wrongType = numericFields.includes(field) ? quote("7") : "true";
      expectJsonRefusal(boundaryJson({ [field]: wrongType }));
    }
    expectJsonRefusal(boundaryJson({ run_id: quote("_invalid"), control_version: quote("8") }));
  });

  it("validates identifiers in Console order before digests and epochs", () => {
    for (const field of identifierFields) {
      expect(refusal(boundaryJson({ [field]: quote("_invalid") }))).toEqual({
        kind: "invalid_identifier",
        field: `boundary_${field}`,
      });
    }
    expect(refusal(boundaryJson({ run_id: quote("_bad"), episode_id: quote("_bad") }))).toEqual({
      kind: "invalid_identifier",
      field: "boundary_run_id",
    });
    expect(refusal(boundaryJson({
      run_id: quote("_bad"),
      observation_sha256: quote("invalid"),
      generation: "0",
    }))).toEqual({ kind: "invalid_identifier", field: "boundary_run_id" });

    expect(decodeContextBoundaryV2Candidate(bytes(boundaryJson({
      run_id: quote("A".repeat(128)),
      episode_id: quote("A._:-z"),
    })))).toBeDefined();
    expect(refusal(boundaryJson({ run_id: quote("A".repeat(129)) }))).toEqual({
      kind: "invalid_identifier",
      field: "boundary_run_id",
    });
    for (const invalid of ["_starts-with-punctuation", "run id", "rún-1"]) {
      expect(refusal(boundaryJson({ run_id: quote(invalid) }))).toEqual({
        kind: "invalid_identifier",
        field: "boundary_run_id",
      });
    }
  });

  it("requires each digest to be exactly 64 lowercase hexadecimal characters", () => {
    for (const [field, label] of digestFields) {
      for (const invalid of ["A".repeat(64), "a".repeat(63), `g${"a".repeat(63)}`]) {
        expect(refusal(boundaryJson({ [field]: quote(invalid) }))).toEqual({
          kind: "invalid_digest",
          field: label,
        });
      }
    }
    expect(refusal(boundaryJson({
      observation_sha256: quote("invalid"),
      catalog_sha256: quote("also-invalid"),
      generation: "0",
    }))).toEqual({ kind: "invalid_digest", field: "boundary_observation_sha256" });
  });

  it("rejects zero for every u64 epoch only after identifier and digest checks", () => {
    for (const field of epochFields) {
      expect(refusal(boundaryJson({ [field]: "0" }))).toEqual({
        kind: "invalid_value",
        field: "boundary_epoch",
      });
    }
    expect(refusal(boundaryJson({
      observation_sha256: quote("invalid"),
      generation: "0",
    }))).toEqual({ kind: "invalid_digest", field: "boundary_observation_sha256" });
  });

  it("preserves all four numeric u64 fields above 2^53 and at u64::MAX", () => {
    for (const field of epochFields) {
      const high = decodeContextBoundaryV2Candidate(bytes(boundaryJson({ [field]: "9007199254740993" })));
      expect(high.boundary[field]).toBe(9_007_199_254_740_993n);
      const maximum = decodeContextBoundaryV2Candidate(bytes(boundaryJson({ [field]: "18446744073709551615" })));
      expect(maximum.boundary[field]).toBe(18_446_744_073_709_551_615n);
    }
    const varied = decodeContextBoundaryV2Candidate(bytes(boundaryJson({
      generation: "9007199254740993",
      controller_epoch: "18446744073709551615",
      gate_epoch: "18446744073709551614",
      control_version: "9007199254740995",
    })));
    expect(varied.boundary.generation).toBe(9_007_199_254_740_993n);
    expect(varied.boundary.controller_epoch).toBe(18_446_744_073_709_551_615n);
    expect(varied.boundary.gate_epoch).toBe(18_446_744_073_709_551_614n);
    expect(varied.boundary.control_version).toBe(9_007_199_254_740_995n);
  });

  it("refuses non-u64 numeric tokens and decimal strings for each epoch field", () => {
    for (const field of epochFields) {
      for (const token of ["-0", "-1", "1.5", "1e0", "18446744073709551616", quote("1")]) {
        expectJsonRefusal(boundaryJson({ [field]: token }));
      }
    }
  });

  it("uses the bounded parser and returns no trusted or hooked input state", () => {
    const input = bytes(boundaryJson());
    let callerHooks = 0;
    Object.defineProperties(input, {
      byteLength: { get: () => { callerHooks += 1; throw new Error("caller byteLength"); } },
      subarray: { value: () => { callerHooks += 1; throw new Error("caller subarray"); } },
      [Symbol.iterator]: { value: () => { callerHooks += 1; throw new Error("caller iterator"); } },
    });
    const result = decodeContextBoundaryV2Candidate(input);
    expect(callerHooks).toBe(0);
    expect(result.trust).toBe("untrusted");
    expect(result.authority).toBe("none");
  });

  it("keeps semantic refusals fixed and free of caller field values", () => {
    const secret = "private owner/run value";
    const error = caught(boundaryJson({ run_id: quote(secret) }));
    expect(error).toBeInstanceOf(OwnerIdentityCandidateError);
    const candidateError = error as OwnerIdentityCandidateError;
    expect(candidateError.refusal).toEqual({ kind: "invalid_identifier", field: "boundary_run_id" });
    expect(candidateError.message).not.toContain(secret);
    expect(JSON.stringify(candidateError.refusal)).not.toContain(secret);
  });
});
