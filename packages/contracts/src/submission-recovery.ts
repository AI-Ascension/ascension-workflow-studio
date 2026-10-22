import { z } from "zod";

/** Exact owner-local recovery vocabulary at the separately pinned Harness
 * source. This does not extend the historical management/v1 error envelope. */
export const SubmissionErrorBodySchema = z.object({
  class: z.enum(["invalid_input", "capability", "conflict", "forbidden", "unresolved",
    "write_state_unknown", "unavailable", "budget", "store", "replay", "authentication"]),
  code: z.string().min(1),
  message: z.string().min(1),
}).strict();

export const SubmissionErrorResponseSchema = z.discriminatedUnion("schema_version", [
  z.object({
    schema_version: z.literal("ascension.management/v1"),
    error: SubmissionErrorBodySchema.extend({ class: SubmissionErrorBodySchema.shape.class.exclude(["write_state_unknown"]) }),
  }).strict(),
  z.object({
    schema_version: z.literal("ascension.management-error/v2"),
    error: SubmissionErrorBodySchema.extend({ class: z.literal("write_state_unknown") }),
  }).strict(),
]);

export const RecoveredRunSubmissionSchema = z.object({
  schema_version: z.literal("ascension.management/v1"),
  workflow_run_id: z.string().min(1).max(128),
  run_revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  status: z.enum(["created", "validated", "running", "waiting_for_provider", "waiting_for_game",
    "pausing", "paused", "cancelling", "reconciling", "completed", "failed", "cancelled", "needs_operator"]),
}).strict();

const recoveryIdentity = {
  schema_version: z.literal("ascension.workflow-submission/v1"),
  request_id: z.string().min(1).max(128),
};
const runId = z.string().min(1).max(128);

export const SubmissionRecoveryResponseSchema = z.discriminatedUnion("state", [
  z.object({ ...recoveryIdentity, state: z.literal("missing"), workflow_run_id: z.null(), response: z.null(), error: z.null() }).strict(),
  z.object({ ...recoveryIdentity, state: z.literal("pending"), workflow_run_id: runId.nullable(), response: z.null(), error: z.null() }).strict(),
  z.object({ ...recoveryIdentity, state: z.literal("submitted"), workflow_run_id: runId, response: RecoveredRunSubmissionSchema, error: z.null() }).strict(),
  z.object({ ...recoveryIdentity, state: z.literal("failed"), workflow_run_id: runId.nullable(), response: z.null(), error: SubmissionErrorBodySchema }).strict(),
]).refine((value) => value.state !== "submitted" || value.workflow_run_id === value.response.workflow_run_id,
  { message: "Recovered run identity does not match its submission response" });

export type SubmissionRecoveryResponse = z.infer<typeof SubmissionRecoveryResponseSchema>;
