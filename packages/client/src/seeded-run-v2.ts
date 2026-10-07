import type {
  RunTargetConfiguration,
  SeedBindingReadbackV2,
  SeedRequestV2,
  SeededRunSubmissionResponseV2,
  TargetAdmissionBinding,
  WorkflowDefinition,
} from "@studio/contracts";

/** Inputs for the additive owner-seeded API. Unlike v1 submitRun, v2 requires
 * the stable ID and exact preflight admission instead of generating either. */
export interface SeededRunSubmissionOptionsV2 {
  requestId: string;
  admission: TargetAdmissionBinding;
  seed: SeedRequestV2;
  target?: RunTargetConfiguration;
}

/** Optional live-owner capability. It is intentionally not part of the
 * required StudioClient interface, so existing fixture and v1 clients remain
 * source-compatible and cannot impersonate owner seed authority. */
export interface SeededRunV2Client {
  submitSeededRunV2(
    definition: WorkflowDefinition,
    instanceId: string,
    profile: string,
    options: SeededRunSubmissionOptionsV2,
  ): Promise<SeededRunSubmissionResponseV2>;
  readSeedBindingV2(workflowRunId: string): Promise<SeedBindingReadbackV2>;
}
