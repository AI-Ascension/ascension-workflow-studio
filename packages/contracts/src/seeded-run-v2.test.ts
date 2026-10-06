import { describe, expect, it } from "vitest";
import {
  SeedBindingReadbackV2Schema,
  SeedRequestV2Schema,
  SeededRunSubmissionResponseV2Schema,
  WORKFLOW_RUN_REQUEST_V2_SCHEMA_VERSION,
  WORKFLOW_RUN_SUBMISSION_V2_SCHEMA_VERSION,
  WORKFLOW_SEED_BINDING_V2_SCHEMA_VERSION,
  WORKFLOW_SEED_REQUEST_V2_SCHEMA_VERSION,
  WorkflowRunRequestV2Schema,
} from "./index";

const validAdmission = {
  schema_version: "ascension.workflow-admission/v1",
  request_id: "studio.run.1",
  workflow_definition_digest: "a".repeat(64),
  target: {
    instance_id: "instance.1",
    execution_profile: "live",
    execution_mode: "live",
    workflow_revision: "1.0.0",
    compatibility_revision: "compat.1",
    capability_revision: "caps.1",
    game_profile: "profile.1",
    save_profile: null,
    inference_profile: null,
    context_capability: null,
    provider_capability: null,
  },
  descriptor_digest: "b".repeat(64),
  catalog_revision: "catalog.1",
};

const explicitBinding = {
  schema_version: WORKFLOW_SEED_BINDING_V2_SCHEMA_VERSION,
  workflow_run_id: "run.1",
  operation_id: "seedop.v2.1",
  mode: "explicit",
  requested_seed: "chosen",
  effective_seed: "chosen",
  algorithm_id: null,
  key_authority_id: null,
  key_version: null,
  configuration_digest: "c".repeat(64),
  state: "candidate_persisted",
};

describe("Harness seed-v2 contracts", () => {
  it("matches Rust canonical seed whitespace, control, surrogate, and UTF-8 byte rules", () => {
    const explicit = (seed: string) => SeedRequestV2Schema.safeParse({
      schema_version: WORKFLOW_SEED_REQUEST_V2_SCHEMA_VERSION,
      mode: "explicit",
      seed,
    }).success;
    expect(explicit("\uFEFFseed\uFEFF")).toBe(true);
    expect(explicit("seed")).toBe(true);
    expect(explicit("\u00A0seed")).toBe(false);
    expect(explicit("seed\u2007")).toBe(false);
    expect(explicit("seed\u0085x")).toBe(false);
    expect(explicit("seed\u0000x")).toBe(false);
    expect(explicit("\uD800")).toBe(false);
    expect(explicit("seed\uD800")).toBe(false);
    expect(explicit("\uDC00")).toBe(false);
    expect(explicit("😀".repeat(16))).toBe(true);
    expect(explicit("😀".repeat(17))).toBe(false);
  });

  it("models serde Option null on input while the canonical derive request omits it", () => {
    const derived = {
      schema_version: WORKFLOW_SEED_REQUEST_V2_SCHEMA_VERSION,
      mode: "derive_once",
    };
    expect(SeedRequestV2Schema.parse({ ...derived, seed: null })).toEqual({ ...derived, seed: null });
    expect(SeedRequestV2Schema.parse(derived)).toEqual(derived);
    expect(SeedRequestV2Schema.safeParse({ ...derived, seed: "caller-choice" }).success).toBe(false);
  });

  it("requires exactly one run source and rejects unknown v2 fields", () => {
    const request = {
      schema_version: WORKFLOW_RUN_REQUEST_V2_SCHEMA_VERSION,
      request_id: "studio.run.1",
      definition: { schema_version: "ascension.workflow/v1" },
      artifact_id: null,
      instance_id: "instance.1",
      profile: "live",
      admission: validAdmission,
      seed: {
        schema_version: WORKFLOW_SEED_REQUEST_V2_SCHEMA_VERSION,
        mode: "derive_once",
      },
    };
    expect(WorkflowRunRequestV2Schema.safeParse(request).success).toBe(true);
    expect(WorkflowRunRequestV2Schema.safeParse({ ...request, unexpected: true }).success).toBe(false);
    expect(WorkflowRunRequestV2Schema.safeParse({ ...request, definition: null }).success).toBe(false);
    expect(WorkflowRunRequestV2Schema.safeParse({ ...request, artifact_id: "artifact.1" }).success).toBe(false);
  });

  it("requires nullable derivation metadata and consistent run/readback identity", () => {
    expect(SeedBindingReadbackV2Schema.safeParse(explicitBinding).success).toBe(true);
    expect(SeedBindingReadbackV2Schema.safeParse({ ...explicitBinding, algorithm_id: undefined }).success).toBe(false);
    expect(SeedBindingReadbackV2Schema.safeParse({ ...explicitBinding, effective_seed: "other" }).success).toBe(false);
    const derived = {
      ...explicitBinding,
      mode: "derive_once",
      requested_seed: null,
      effective_seed: "stored-choice",
      algorithm_id: "hmac-sha256-v1",
      key_authority_id: "authority.1",
      key_version: "key.1",
    };
    expect(SeedBindingReadbackV2Schema.safeParse(derived).success).toBe(true);
    const response = {
      schema_version: WORKFLOW_RUN_SUBMISSION_V2_SCHEMA_VERSION,
      run: { schema_version: "ascension.management/v1", workflow_run_id: "run.1", run_revision: 0, status: "created" },
      seed_binding: explicitBinding,
    };
    expect(SeededRunSubmissionResponseV2Schema.safeParse(response).success).toBe(true);
    expect(SeededRunSubmissionResponseV2Schema.safeParse({
      ...response,
      run: { ...response.run, workflow_run_id: "run.other" },
    }).success).toBe(false);
  });

  it("matches the Rust seed-key identity length and ASCII character rules", () => {
    const derived = {
      ...explicitBinding,
      mode: "derive_once",
      requested_seed: null,
      effective_seed: "stored-choice",
      algorithm_id: "hmac-sha256-v1",
      key_authority_id: "authority.1",
      key_version: "key.1",
    };
    for (const field of ["key_authority_id", "key_version"] as const) {
      for (const value of ["_authority", ".authority", "-key"]) {
        expect(SeedBindingReadbackV2Schema.safeParse({ ...derived, [field]: value }).success).toBe(true);
      }
      expect(SeedBindingReadbackV2Schema.safeParse({ ...derived, [field]: "k".repeat(64) }).success).toBe(true);
      for (const value of ["", "authority:1", "k".repeat(65)]) {
        expect(SeedBindingReadbackV2Schema.safeParse({ ...derived, [field]: value }).success).toBe(false);
      }
    }
  });
});
