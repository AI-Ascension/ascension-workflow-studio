import { describe, expect, it } from "vitest";
import {
  INFERENCE_PROFILE_REVISION_RESPONSE_SCHEMA_VERSION,
  InferenceProfileReferenceSchema,
  InferenceProfileRevisionOutcomeSchema,
  InferenceProfileRevisionRequestSchema,
  InferenceProfileRevisionResponseSchema,
  adoptInferenceProfileRevision,
} from "./inference-profile-revision";
import { reseal } from "./inference-profile-catalog.test-fixtures";
import type { InferenceProfileDescriptor } from "./inference-profile-catalog";

const DIGEST = "a".repeat(64);

/** A minimal descriptor that is internally consistent, built from the real
 * sealed fixture so its digest is genuine rather than invented. */
import fixture from "../../../contracts/accepted/inference-profile/catalog-conformance.json" with { type: "json" };

function sealed(overrides: Partial<InferenceProfileDescriptor> = {}): InferenceProfileDescriptor {
  const catalog = reseal(structuredClone(
    fixture.catalogs.find((row) => row.name === "editable")!.catalog,
  ) as never);
  return { ...(catalog.descriptors[0] as InferenceProfileDescriptor), ...overrides };
}

const request = {
  schema_version: "ascension.inference-profile-revision/v1",
  expected_revision_digest: DIGEST,
  client_mutation_id: "studio.revision.abc123",
  version: "1.1.0",
  prompt_revision: "synthetic.prompt.v2",
  settings_revision: "synthetic.settings.v2",
  supported_settings: ["max_output_tokens"],
  effective_budgets: {
    max_input_bytes: 131_072,
    max_output_tokens: 8192,
    max_provider_calls: 64,
  },
};

describe("inference profile revision request is closed", () => {
  it("admits the editable allow-list exactly as the producer states it", () => {
    const parsed = InferenceProfileRevisionRequestSchema.safeParse(request);
    expect(parsed.success).toBe(true);
    expect(Object.keys(parsed.success ? parsed.data : {}).sort()).toEqual([
      "client_mutation_id", "effective_budgets", "expected_revision_digest",
      "prompt_revision", "schema_version", "settings_revision",
      "supported_settings", "version",
    ]);
  });

  /** The producer's own justification for `additionalProperties: false`:
   * "any field outside the editable allow-list is rejected rather than
   * ignored, so an unadvertised authority or credential field cannot be
   * smuggled through an edit that is otherwise well-formed." Each field below
   * is one the producer deliberately omits, so each must be refused HERE and
   * never sent. */
  it.each([
    "adapter", "requested_model", "resolved_model", "node_kinds", "operations",
    "context_compatibility", "continuity", "state", "grants", "profile_id",
    "api_key", "endpoint", "executable", "provider_url", "prompt_text",
    "allowed_operations", "output_type",
  ])("rejects an unadvertised %s field instead of ignoring it", (field) => {
    const parsed = InferenceProfileRevisionRequestSchema.safeParse({ ...request, [field]: "smuggled" });
    expect(parsed.success).toBe(false);
  });

  it("rejects a nested authority smuggled inside the budgets object", () => {
    const parsed = InferenceProfileRevisionRequestSchema.safeParse({
      ...request,
      effective_budgets: { ...request.effective_budgets, endpoint: "https://provider.invalid" },
    });
    expect(parsed.success).toBe(false);
  });

  it("applies the producer's own identifier, semver, digest and budget bounds", () => {
    // `validate_identifier`: ASCII alphanumeric first.
    expect(InferenceProfileRevisionRequestSchema.safeParse({ ...request, client_mutation_id: ".leading" }).success).toBe(false);
    // 1..=128 BYTES, not code units.
    expect(InferenceProfileRevisionRequestSchema.safeParse({ ...request, prompt_revision: "a".repeat(129) }).success).toBe(false);
    expect(InferenceProfileRevisionRequestSchema.safeParse({ ...request, prompt_revision: "a".repeat(128) }).success).toBe(true);
    // `SemanticVersion::new`: no empty run, no leading zero.
    for (const version of ["1.0", "1.0.0.0", "01.0.0", "1.02.3", "v1.0.0"]) {
      expect(InferenceProfileRevisionRequestSchema.safeParse({ ...request, version }).success).toBe(false);
    }
    // `validate_digest`: exactly 64 lowercase hex.
    expect(InferenceProfileRevisionRequestSchema.safeParse({ ...request, expected_revision_digest: "A".repeat(64) }).success).toBe(false);
    expect(InferenceProfileRevisionRequestSchema.safeParse({ ...request, expected_revision_digest: "a".repeat(63) }).success).toBe(false);
    // Producer ceilings: 128 KiB in, 2,000,000 out, 10,000 calls; each >= 1.
    for (const [key, over, under] of [
      ["max_input_bytes", 131_073, 0],
      ["max_output_tokens", 2_000_001, 0],
      ["max_provider_calls", 10_001, 0],
    ] as const) {
      expect(InferenceProfileRevisionRequestSchema.safeParse({
        ...request, effective_budgets: { ...request.effective_budgets, [key]: over },
      }).success).toBe(false);
      expect(InferenceProfileRevisionRequestSchema.safeParse({
        ...request, effective_budgets: { ...request.effective_budgets, [key]: under },
      }).success).toBe(false);
    }
    // 32-item, unique-item list.
    expect(InferenceProfileRevisionRequestSchema.safeParse({
      ...request, supported_settings: Array.from({ length: 33 }, (_, index) => `setting.${index}`),
    }).success).toBe(false);
    expect(InferenceProfileRevisionRequestSchema.safeParse({
      ...request, supported_settings: ["same", "same"],
    }).success).toBe(false);
  });

  it("rejects a wrong schema_version rather than assuming the caller meant this one", () => {
    expect(InferenceProfileRevisionRequestSchema.safeParse({
      ...request, schema_version: "ascension.inference-profile/v1",
    }).success).toBe(false);
  });
});

describe("inference profile revision reference", () => {
  it("admits exactly profile_id:version:digest", () => {
    expect(InferenceProfileReferenceSchema.safeParse(`decision.live.v1:1.0.0:${DIGEST}`).success).toBe(true);
    for (const bad of [
      `decision.live.v1:1.0:${DIGEST}`,
      `decision.live.v1:01.0.0:${DIGEST}`,
      `decision.live.v1:1.0.0:${"A".repeat(64)}`,
      `decision.live.v1:1.0.0`,
      `decision.live.v1:1.0.0:${DIGEST}:extra`,
    ]) {
      expect(InferenceProfileReferenceSchema.safeParse(bad).success).toBe(false);
    }
  });
});

describe("inference profile revision response", () => {
  const revision = sealed();
  const reference = `${revision.profile_id}:${revision.version}:${revision.digest}`;

  it("admits each of the owner's three outcomes with a consistent reference", () => {
    for (const outcome of InferenceProfileRevisionOutcomeSchema.options) {
      const parsed = InferenceProfileRevisionResponseSchema.safeParse({
        schema_version: INFERENCE_PROFILE_REVISION_RESPONSE_SCHEMA_VERSION,
        outcome,
        profile_id: revision.profile_id,
        reference,
        revision,
      });
      expect(parsed.success).toBe(true);
    }
  });

  /** The owner composes `reference` from `revision.version` and
   * `revision.digest`. A response whose reference names something else is not
   * one this owner produced, and pinning it would mean acting on a reference
   * the owner never admitted. */
  it("refuses a reference that does not name its own revision", () => {
    const parsed = InferenceProfileRevisionResponseSchema.safeParse({
      schema_version: INFERENCE_PROFILE_REVISION_RESPONSE_SCHEMA_VERSION,
      outcome: "adopted",
      profile_id: revision.profile_id,
      reference: `${revision.profile_id}:9.9.9:${"b".repeat(64)}`,
      revision,
    });
    expect(parsed.success).toBe(false);
  });

  it("applies the descriptor's own closed shape and digest check to the embedded revision", () => {
    const tampered = { ...revision, digest: "f".repeat(64) };
    const parsed = InferenceProfileRevisionResponseSchema.safeParse({
      schema_version: INFERENCE_PROFILE_REVISION_RESPONSE_SCHEMA_VERSION,
      outcome: "adopted",
      profile_id: revision.profile_id,
      reference: `${revision.profile_id}:${revision.version}:${"f".repeat(64)}`,
      revision: tampered,
    });
    expect(parsed.success).toBe(false);
  });

  it("refuses an unknown outcome and an unknown response field", () => {
    const base = {
      schema_version: INFERENCE_PROFILE_REVISION_RESPONSE_SCHEMA_VERSION,
      outcome: "adopted",
      profile_id: revision.profile_id,
      reference,
      revision,
    };
    expect(InferenceProfileRevisionResponseSchema.safeParse({ ...base, outcome: "pending" }).success).toBe(false);
    expect(InferenceProfileRevisionResponseSchema.safeParse({ ...base, adopted_at: "2026-09-30T00:00:00Z" }).success).toBe(false);
  });
});

describe("adoption classification is explicit per outcome", () => {
  const revision = sealed();
  const reference = `${revision.profile_id}:${revision.version}:${revision.digest}`;
  const of = (outcome: string) => adoptInferenceProfileRevision({
    schema_version: INFERENCE_PROFILE_REVISION_RESPONSE_SCHEMA_VERSION,
    outcome: outcome as "adopted",
    profile_id: revision.profile_id,
    reference,
    revision,
  });

  it("marks only adopted as adopted", () => {
    expect(of("adopted")).toMatchObject({ adopted: true, conflicted: false });
  });

  /** A replay means the mutation id was already applied. Collapsing it into
   * "adopted" would double-count one edit, which is exactly what the
   * producer's mutation record exists to prevent. */
  it("does not present a replay as a fresh adoption", () => {
    expect(of("replayed")).toMatchObject({ outcome: "replayed", adopted: false, conflicted: false });
  });

  it("marks a lost swap as conflicted and never as adopted", () => {
    expect(of("conflict")).toMatchObject({ outcome: "conflict", adopted: false, conflicted: true });
  });
});
