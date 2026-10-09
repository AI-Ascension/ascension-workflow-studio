import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { decodeContextBoundaryV2Candidate } from "./boundary";
import { OwnerIdentityCandidateError } from "./wire-scalars";

interface Fixture {
  id: string;
  input_base64: string;
  input_sha256: string;
  expected: {
    accepted: boolean;
    boundary?: Record<string, string>;
    refusal?: { kind: string; field?: string };
  };
  producer_wire_base64?: string;
  producer_wire_sha256?: string;
}

const root = resolve(process.cwd(), "tests/fixtures/console-owner-v2-boundary");
const index = [1, 2].flatMap((number) => JSON.parse(
  readFileSync(resolve(root, `index-${number}.json`), "utf8"),
) as { file: string; sha256: string }[]);
const epochs = new Set(["generation", "controller_epoch", "gate_epoch", "control_version"]);
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

describe("pinned Console ContextBoundary producer seam", () => {
  it.each(index)("agrees with the actual producer observation for $file", (entry) => {
    const bytes = readFileSync(resolve(root, entry.file));
    expect(digest(bytes)).toBe(entry.sha256);
    const fixture = JSON.parse(bytes.toString("utf8")) as Fixture;
    const input = new Uint8Array(Buffer.from(fixture.input_base64, "base64"));
    expect(digest(input)).toBe(fixture.input_sha256);
    if (fixture.expected.accepted) {
      const expected = Object.fromEntries(Object.entries(fixture.expected.boundary!).map(
        ([key, value]) => [key, epochs.has(key) ? BigInt(value) : value],
      ));
      const candidate = decodeContextBoundaryV2Candidate(input);
      expect(candidate.boundary).toEqual(expected);
      expect(candidate.kind).toBe("untrusted_context_boundary_v2");
      expect(candidate.trust).toBe("untrusted");
      expect(candidate.authority).toBe("none");
      expect(Object.isFrozen(candidate)).toBe(true);
      expect(Object.isFrozen(candidate.boundary)).toBe(true);
      const producerWire = new Uint8Array(Buffer.from(fixture.producer_wire_base64!, "base64"));
      expect(digest(producerWire)).toBe(fixture.producer_wire_sha256);
      expect(decodeContextBoundaryV2Candidate(producerWire).boundary).toEqual(expected);
    } else {
      let caught: unknown;
      try {
        decodeContextBoundaryV2Candidate(input);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(OwnerIdentityCandidateError);
      expect((caught as OwnerIdentityCandidateError).refusal).toEqual(fixture.expected.refusal);
    }
  });
});
