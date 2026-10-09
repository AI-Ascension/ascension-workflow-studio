import { parseBoundedJson, type BoundedJsonValue } from "./lossless-json";
import { expectClosedObject, expectString, expectU64 } from "./json-token";
import {
  correlationMismatch,
  invalidValue,
  OwnerIdentityCandidateError,
  validateCorrelationText,
  validateIdentifier,
} from "./wire-scalars";

export interface ConsoleOwnerIdentityCandidateV2 {
  readonly issuer: string;
  readonly subject: string;
  readonly audience: string;
  readonly credential_id: string;
  readonly grant_id: string;
  readonly grant_generation: bigint;
  readonly grant_expires_at: bigint;
}

export interface ConsoleOwnerScopeCandidateV2 {
  readonly project_id: string;
  readonly run_id: string;
  readonly episode_id: string;
  readonly agent_id: string;
}

export interface HarnessActorIdentityCandidateV2 {
  readonly actor_subject: string;
  readonly owner_id: string;
  readonly workflow_run_id: string;
  readonly credential_reference_id: string;
  readonly credential_expires_at: bigint;
}

export interface OwnerIdentityCorrelationCandidateV2 {
  readonly console: ConsoleOwnerIdentityCandidateV2;
  readonly console_scope: ConsoleOwnerScopeCandidateV2;
  readonly harness: HarnessActorIdentityCandidateV2;
}

export interface UntrustedOwnerIdentityCandidateV2 {
  readonly kind: "untrusted_owner_identity_correlation_v2";
  readonly trust: "untrusted";
  readonly authority: "none";
  readonly identity: OwnerIdentityCorrelationCandidateV2;
}

const consoleFields = ["issuer", "subject", "audience", "credential_id", "grant_id", "grant_generation", "grant_expires_at"] as const;
const scopeFields = ["project_id", "run_id", "episode_id", "agent_id"] as const;
const harnessFields = ["actor_subject", "owner_id", "workflow_run_id", "credential_reference_id", "credential_expires_at"] as const;
const rootFields = ["console", "console_scope", "harness"] as const;

/** Decode only Console OwnerIdentityCorrelationV2 bytes; this result is not authenticated. */
export function decodeOwnerIdentityCorrelationV2Candidate(input: Uint8Array): UntrustedOwnerIdentityCandidateV2 {
  const document = parseBoundedJson(input);
  const root = expectClosedObject(document.value, rootFields);
  const console = decodeConsole(root.console);
  const scope = decodeScope(root.console_scope);
  const harness = decodeHarness(root.harness);
  validateConsole(console);
  validateScope(scope);
  validateHarness(harness);
  if (console.subject !== harness.actor_subject) correlationMismatch("actor_subject");
  if (scope.run_id !== harness.workflow_run_id) correlationMismatch("workflow_run_id");
  const identity = Object.freeze({ console, console_scope: scope, harness });
  return Object.freeze({
    kind: "untrusted_owner_identity_correlation_v2",
    trust: "untrusted",
    authority: "none",
    identity,
  });
}

function decodeConsole(value: BoundedJsonValue): ConsoleOwnerIdentityCandidateV2 {
  const object = expectClosedObject(value, consoleFields);
  return Object.freeze({
    issuer: expectString(object.issuer),
    subject: expectString(object.subject),
    audience: expectString(object.audience),
    credential_id: expectString(object.credential_id),
    grant_id: expectString(object.grant_id),
    grant_generation: expectU64(object.grant_generation),
    grant_expires_at: expectU64(object.grant_expires_at),
  });
}

function decodeScope(value: BoundedJsonValue): ConsoleOwnerScopeCandidateV2 {
  const object = expectClosedObject(value, scopeFields);
  return Object.freeze({
    project_id: expectString(object.project_id),
    run_id: expectString(object.run_id),
    episode_id: expectString(object.episode_id),
    agent_id: expectString(object.agent_id),
  });
}

function decodeHarness(value: BoundedJsonValue): HarnessActorIdentityCandidateV2 {
  const object = expectClosedObject(value, harnessFields);
  return Object.freeze({
    actor_subject: expectString(object.actor_subject),
    owner_id: expectString(object.owner_id),
    workflow_run_id: expectString(object.workflow_run_id),
    credential_reference_id: expectString(object.credential_reference_id),
    credential_expires_at: expectU64(object.credential_expires_at),
  });
}

function validateConsole(value: ConsoleOwnerIdentityCandidateV2): void {
  validateCorrelationText("console_issuer", value.issuer);
  validateCorrelationText("console_audience", value.audience);
  validateCorrelationText("console_credential_id", value.credential_id);
  validateIdentifier("console_subject", value.subject);
  validateIdentifier("console_grant_id", value.grant_id);
  if (value.grant_expires_at === 0n) invalidValue("console_grant_lifetime");
}

function validateScope(value: ConsoleOwnerScopeCandidateV2): void {
  validateIdentifier("console_project_id", value.project_id);
  validateIdentifier("console_run_id", value.run_id);
  validateIdentifier("console_episode_id", value.episode_id);
  validateIdentifier("console_agent_id", value.agent_id);
}

function validateHarness(value: HarnessActorIdentityCandidateV2): void {
  validateIdentifier("harness_actor_subject", value.actor_subject);
  validateIdentifier("harness_owner_id", value.owner_id);
  validateIdentifier("harness_workflow_run_id", value.workflow_run_id);
  validateCorrelationText("harness_credential_reference_id", value.credential_reference_id);
  if (value.credential_expires_at === 0n) invalidValue("harness_credential_expiry");
}

export function isOwnerIdentityCandidateRefusal(error: unknown): error is OwnerIdentityCandidateError {
  return error instanceof OwnerIdentityCandidateError;
}
