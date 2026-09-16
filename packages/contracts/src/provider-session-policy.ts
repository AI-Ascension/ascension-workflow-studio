import { z } from "zod";

const digestSchema = z.string().regex(/^[0-9a-f]{64}$/);
const identifierSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const safeCountSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const policyVersionSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

export const ProviderSessionPolicyCommandSchema = z.literal("ascension.provider-session.policy-owner-command.v1");
export const ProviderSessionPolicyViewSchema = z.literal("ascension.provider-session.policy-owner-view.v1");

export const ProviderSessionPolicyActiveSchema = z.object({
  sha256: digestSchema,
  policy_id: identifierSchema,
  version: policyVersionSchema,
  mode: z.enum(["disabled", "fixture_only", "inspect_only", "enabled"]),
  continuity: z.enum(["strict_reviewed", "observed_persistent"]),
  max_completed_turns: safeCountSchema,
  history_ttl_seconds: safeCountSchema,
  epoch: policyVersionSchema,
}).strict();

export const ProviderSessionPolicyHistorySchema = z.object({
  sha256: digestSchema,
  policy_id: identifierSchema,
  version: policyVersionSchema,
  mode: z.enum(["disabled", "fixture_only", "inspect_only", "enabled"]),
  continuity: z.enum(["strict_reviewed", "observed_persistent"]),
  active: z.boolean(),
}).strict();

export const ProviderSessionPolicyProposalSchema = z.object({
  proposal_id: identifierSchema,
  proposal_sha256: digestSchema,
  source_sha256: digestSchema,
  target_sha256: digestSchema,
  state: z.enum(["proposed", "approved", "adopted"]),
  approval_recorded: z.boolean(),
  adopted_policy_sha256: digestSchema.nullable(),
}).strict();

export const ProviderSessionPolicyViewValueSchema = z.object({
  run_id: identifierSchema,
  revision: policyVersionSchema,
  active: ProviderSessionPolicyActiveSchema.nullable(),
  history: z.array(ProviderSessionPolicyHistorySchema).max(64),
  proposals: z.array(ProviderSessionPolicyProposalSchema).max(64),
}).strict();

export const ProviderSessionPolicyViewResponseSchema = z.object({
  schema_version: ProviderSessionPolicyViewSchema,
  operation: z.literal("current"),
  value: ProviderSessionPolicyViewValueSchema,
  effect_class: z.literal("local_metadata_only"),
  inference_calls: z.literal(0),
  game_effects: z.literal(0),
}).strict();

const commandResponseFields = {
  schema_version: ProviderSessionPolicyCommandSchema,
  revision: policyVersionSchema,
  effect_class: z.literal("local_metadata_only"),
  inference_calls: z.literal(0),
  game_effects: z.literal(0),
};

export const ProviderSessionPolicyCommandResponseSchema = z.discriminatedUnion("operation", [
  z.object({
    ...commandResponseFields,
    operation: z.literal("import"),
    policy_sha256: digestSchema,
    proposal_sha256: z.null(),
  }).strict(),
  z.object({
    ...commandResponseFields,
    operation: z.literal("propose"),
    policy_sha256: z.null(),
    proposal_sha256: digestSchema,
  }).strict(),
  z.object({
    ...commandResponseFields,
    operation: z.literal("approve"),
    policy_sha256: z.null(),
    proposal_sha256: z.null(),
  }).strict(),
  z.object({
    ...commandResponseFields,
    operation: z.literal("adopt"),
    policy_sha256: digestSchema,
    proposal_sha256: z.null(),
  }).strict(),
]);

export type ProviderSessionPolicyActive = z.infer<typeof ProviderSessionPolicyActiveSchema>;
export type ProviderSessionPolicyHistory = z.infer<typeof ProviderSessionPolicyHistorySchema>;
export type ProviderSessionPolicyProposal = z.infer<typeof ProviderSessionPolicyProposalSchema>;
export type ProviderSessionPolicyViewValue = z.infer<typeof ProviderSessionPolicyViewValueSchema>;
export type ProviderSessionPolicyViewResponse = z.infer<typeof ProviderSessionPolicyViewResponseSchema>;
export type ProviderSessionPolicyCommandResponse = z.infer<typeof ProviderSessionPolicyCommandResponseSchema>;
