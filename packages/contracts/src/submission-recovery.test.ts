import Ajv2020 from "ajv/dist/2020";
import { describe, expect, it } from "vitest";
import recoverySchema from "../../../contracts/management-recovery/submission-v1.schema.json";
import errorSchema from "../../../contracts/management-recovery/error-v2.schema.json";
import vectors from "../../../contracts/management-recovery/vectors.json";
import { SubmissionErrorResponseSchema, SubmissionRecoveryResponseSchema } from "./submission-recovery";

const ajv = new Ajv2020({ strict: false, allErrors: true });
const validateRecovery = ajv.compile(recoverySchema);
const validateError = ajv.compile(errorSchema);

describe("producer-pinned original submission recovery contract", () => {
  it.each(vectors.recovery)("accepts the unchanged producer vector $request_id", (vector) => {
    expect(validateRecovery(vector), JSON.stringify(validateRecovery.errors)).toBe(true);
    expect(SubmissionRecoveryResponseSchema.parse(vector)).toEqual(vector);
  });

  it("admits v2 write_state_unknown without widening the v1 error envelope", () => {
    expect(validateError(vectors.error)).toBe(true);
    expect(SubmissionErrorResponseSchema.parse(vectors.error)).toEqual(vectors.error);
    expect(SubmissionErrorResponseSchema.safeParse({ ...vectors.error, schema_version: "ascension.management/v1" }).success).toBe(false);
    expect(SubmissionErrorResponseSchema.safeParse({ ...vectors.error, error: { ...vectors.error.error, class: "unresolved" } }).success).toBe(false);
  });

  it("rejects contradictory states, absent fields and unrecognized vocabulary", () => {
    const missing = vectors.recovery[0];
    const submitted = vectors.recovery.find((value) => value.state === "submitted")!;
    const invalid = [
      { ...missing, state: "not_found" }, { ...missing, workflow_run_id: "not-null" },
      { ...missing, response: submitted.response }, { ...missing, extra: true },
      { ...missing, schema_version: "ascension.workflow-submission/v2" },
      { ...missing, request_id: "" }, { ...missing, error: undefined },
    ];
    for (const vector of invalid) {
      expect(validateRecovery(vector)).toBe(false);
      expect(SubmissionRecoveryResponseSchema.safeParse(vector).success).toBe(false);
    }
  });

  it("adds consumer identity joining and exact-integer safeguards", () => {
    const submitted = vectors.recovery.find((value) => value.state === "submitted")!;
    for (const vector of [
      { ...submitted, workflow_run_id: "different" },
      { ...submitted, response: { ...submitted.response, run_revision: Number.MAX_SAFE_INTEGER + 1 } },
    ]) {
      expect(validateRecovery(vector)).toBe(true);
      expect(SubmissionRecoveryResponseSchema.safeParse(vector).success).toBe(false);
    }
  });
});
