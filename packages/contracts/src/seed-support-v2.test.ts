import { describe, expect, it } from "vitest";
import { TargetSeedSupportCatalogV2Schema } from "./index";
const target = {
  instance_id: "owner-a", execution_profiles: ["live.workflow.v1"],
  execution_mode: "live", compatibility_revision: "compat.v1",
  capability_revision: "caps.v1", availability: "available",
  supported_operations: ["workflow:live"], capabilities: ["workflow:context:read"],
  game_profiles: ["sts2-live-v1"], save_profiles: [], inference_profiles: ["exo.runtime-v3"],
};
const entry = {
  target, descriptor_digest: "93283a6890aae5b87aa656e5df60ca7ca090114300caca6fb667d309275acfe3",
  durable_candidate_binding_modes: ["explicit", "derive_once"],
  ready_candidate_modes: ["explicit"], supported_launch_setups: [],
};
const support = {
  schema_version: "ascension.workflow-targets/v2", catalog_revision: "runtime-v3:profile-a",
  support_revision: "seed-support.v1", targets: [entry],
};
describe("Harness seed-support v2 closed discovery", () => {
  const valid = (body: unknown) => TargetSeedSupportCatalogV2Schema.safeParse(body).success;
  it("decodes supported candidate mode only, never native launch", () => {
    expect(valid(support)).toBe(true);
    expect(TargetSeedSupportCatalogV2Schema.parse(support).targets[0].supported_launch_setups).toEqual([]);
  });
  it("rejects unknown revisions, fields, launch setups and duplicate ids", () => {
    expect(valid({ ...support, support_revision: "seed-support.v2" })).toBe(false);
    expect(valid({ ...support, unknown: true })).toBe(false);
    expect(valid({ ...support, targets: [entry, entry] })).toBe(false);
    expect(valid({ ...support, targets: [{ ...entry, supported_launch_setups: ["standard"] }] })).toBe(false);
  });
  it("rejects duplicate modes and readiness without durable support", () => {
    expect(valid({ ...support, targets: [{ ...entry, ready_candidate_modes: ["explicit", "explicit"] }] })).toBe(false);
    expect(valid({ ...support, targets: [{ ...entry, durable_candidate_binding_modes: ["explicit"], ready_candidate_modes: ["derive_once"] }] })).toBe(false);
  });
});
