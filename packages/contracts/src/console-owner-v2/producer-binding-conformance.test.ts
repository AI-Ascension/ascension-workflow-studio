import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { decodeContextOwnerBindingV1Candidate } from "./binding";
import { OwnerIdentityCandidateError } from "./wire-scalars";

type MetadataValue = string | boolean | { [key: string]: MetadataValue };
interface Fixture {
  input_base64: string;
  input_sha256: string;
  expected: {
    accepted: boolean;
    binding?: { [key: string]: MetadataValue };
    refusal?: { kind: string; field?: string; expected?: string };
  };
  producer_wire_base64?: string;
  producer_wire_sha256?: string;
}

const root = resolve(process.cwd(), "tests/fixtures/console-owner-v1-binding");
const index = [1, 2, 3, 4].flatMap((number) => JSON.parse(
  readFileSync(resolve(root, `index-${number}.json`), "utf8"),
) as { file: string; sha256: string }[]);
const outerCounters = new Set(["binding_version", "lease_epoch", "plan_epoch"]);
const boundaryCounters = new Set(["generation", "controller_epoch", "gate_epoch", "control_version"]);
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

function typedMetadata(value: MetadataValue, path: readonly string[] = []): unknown {
  if (typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => {
    const counter = (path.length === 0 && outerCounters.has(key)) ||
      (path.length === 1 && path[0] === "boundary" && boundaryCounters.has(key));
    if (counter) {
      expect(typeof child).toBe("string");
      expect(child).toMatch(/^(0|[1-9][0-9]*)$/);
      return [key, BigInt(child as string)];
    }
    return [key, typedMetadata(child, [...path, key])];
  }));
}

describe("pinned Console ContextOwnerBinding producer seam", () => {
  it("includes every recorded producer input exactly once", () => {
    expect(index).toHaveLength(208);
    expect(new Set(index.map((entry) => entry.file)).size).toBe(208);
  });

  it.each(index)("agrees with the actual producer observation for $file", (entry) => {
    const bytes = readFileSync(resolve(root, entry.file));
    expect(digest(bytes)).toBe(entry.sha256);
    const fixture = JSON.parse(bytes.toString("utf8")) as Fixture;
    const input = new Uint8Array(Buffer.from(fixture.input_base64, "base64"));
    expect(digest(input)).toBe(fixture.input_sha256);
    if (fixture.expected.accepted) {
      const expected = typedMetadata(fixture.expected.binding!);
      const candidate = decodeContextOwnerBindingV1Candidate(input);
      expect(candidate.binding).toEqual(expected);
      expect(candidate.kind).toBe("untrusted_context_owner_binding_v1");
      expect(candidate.trust).toBe("untrusted");
      expect(candidate.authority).toBe("none");
      expect(Object.isFrozen(candidate)).toBe(true);
      for (const object of [candidate.binding, candidate.binding.boundary,
        candidate.binding.grants, candidate.binding.continuity]) {
        expect(Object.isFrozen(object)).toBe(true);
      }
      const wire = new Uint8Array(Buffer.from(fixture.producer_wire_base64!, "base64"));
      expect(digest(wire)).toBe(fixture.producer_wire_sha256);
      expect(decodeContextOwnerBindingV1Candidate(wire).binding).toEqual(expected);
    } else {
      let caught: unknown;
      try {
        decodeContextOwnerBindingV1Candidate(input);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(OwnerIdentityCandidateError);
      expect((caught as OwnerIdentityCandidateError).refusal).toEqual(fixture.expected.refusal);
    }
  });
});
