import { expectBoolean, expectClosedObject, expectString, expectU64 } from "./json-token";
import { parseBoundedJson, type BoundedJsonValue } from "./lossless-json";
import {
  CONTEXT_OWNER_BINDING_SCHEMA_V1,
  invalidValue,
  refuseJson,
  unsupportedBindingSchema,
  validateDigest,
  validateIdentifier,
  type BindingDigestField,
  type BindingIdentifierField,
} from "./wire-scalars";
import {
  decodeContextBoundaryCandidateShape,
  validateContextBoundaryCandidate,
  type ContextBoundaryCandidateV2,
} from "./boundary";

export type ContextBindingStateCandidateV1 =
  | "available"
  | "disabled"
  | "unattached"
  | "denied"
  | "stale"
  | "unsupported";

export interface ContextBindingGrantsCandidateV1 {
  readonly metadata_read: boolean;
  readonly content_read: boolean;
  readonly edit: boolean;
  readonly control: boolean;
}

export interface ContextBindingContinuityCandidateV1 {
  readonly survives_controller_restart: boolean;
  readonly receipt_recovery: boolean;
  readonly provider_session_continuity: boolean;
}

export interface ContextOwnerBindingCandidateV1 {
  readonly schema_version: string;
  readonly owner_id: string;
  readonly owner_version: string;
  readonly invocation_id: string;
  readonly binding_id: string;
  readonly binding_version: bigint;
  readonly binding_digest: string;
  readonly context_ref: string;
  readonly instance_id: string;
  readonly node_kind: string;
  readonly state: ContextBindingStateCandidateV1;
  readonly workflow_run_id: string;
  readonly definition_digest: string;
  readonly graph_id: string;
  readonly node_id: string;
  readonly node_execution_id: string;
  readonly boundary: ContextBoundaryCandidateV2;
  readonly lease_epoch: bigint;
  readonly snapshot_id: string;
  readonly approved_revision_id: string;
  readonly plan_epoch: bigint;
  readonly grants: ContextBindingGrantsCandidateV1;
  readonly continuity: ContextBindingContinuityCandidateV1;
}

export interface UntrustedContextOwnerBindingCandidateV1 {
  readonly kind: "untrusted_context_owner_binding_v1";
  readonly trust: "untrusted";
  readonly authority: "none";
  readonly binding: ContextOwnerBindingCandidateV1;
}

const bindingFields = [
  "schema_version", "owner_id", "owner_version", "invocation_id", "binding_id", "binding_version",
  "binding_digest", "context_ref", "instance_id", "node_kind", "state", "workflow_run_id",
  "definition_digest", "graph_id", "node_id", "node_execution_id", "boundary", "lease_epoch",
  "snapshot_id", "approved_revision_id", "plan_epoch", "grants", "continuity",
] as const;

const grantsFields = ["metadata_read", "content_read", "edit", "control"] as const;
const continuityFields = ["survives_controller_restart", "receipt_recovery", "provider_session_continuity"] as const;
const bindingStates: readonly ContextBindingStateCandidateV1[] = [
  "available", "disabled", "unattached", "denied", "stale", "unsupported",
];

/** Decode the claimed top-level ContextOwnerBindingV1 from bounded bytes as untrusted data. */
export function decodeContextOwnerBindingV1Candidate(input: Uint8Array): UntrustedContextOwnerBindingCandidateV1 {
  const document = parseBoundedJson(input);
  const binding = decodeBindingShape(document.value);
  validateBinding(binding);
  return Object.freeze({
    kind: "untrusted_context_owner_binding_v1",
    trust: "untrusted",
    authority: "none",
    binding,
  });
}

function decodeBindingShape(value: BoundedJsonValue): ContextOwnerBindingCandidateV1 {
  const object = expectClosedObject(value, bindingFields);
  return Object.freeze({
    schema_version: expectString(object.schema_version),
    owner_id: expectString(object.owner_id),
    owner_version: expectString(object.owner_version),
    invocation_id: expectString(object.invocation_id),
    binding_id: expectString(object.binding_id),
    binding_version: expectU64(object.binding_version),
    binding_digest: expectString(object.binding_digest),
    context_ref: expectString(object.context_ref),
    instance_id: expectString(object.instance_id),
    node_kind: expectString(object.node_kind),
    state: expectState(object.state),
    workflow_run_id: expectString(object.workflow_run_id),
    definition_digest: expectString(object.definition_digest),
    graph_id: expectString(object.graph_id),
    node_id: expectString(object.node_id),
    node_execution_id: expectString(object.node_execution_id),
    boundary: decodeContextBoundaryCandidateShape(object.boundary),
    lease_epoch: expectU64(object.lease_epoch),
    snapshot_id: expectString(object.snapshot_id),
    approved_revision_id: expectString(object.approved_revision_id),
    plan_epoch: expectU64(object.plan_epoch),
    grants: decodeGrants(object.grants),
    continuity: decodeContinuity(object.continuity),
  });
}

function decodeGrants(value: BoundedJsonValue): ContextBindingGrantsCandidateV1 {
  const object = expectClosedObject(value, grantsFields);
  return Object.freeze({
    metadata_read: expectBoolean(object.metadata_read),
    content_read: expectBoolean(object.content_read),
    edit: expectBoolean(object.edit),
    control: expectBoolean(object.control),
  });
}

function decodeContinuity(value: BoundedJsonValue): ContextBindingContinuityCandidateV1 {
  const object = expectClosedObject(value, continuityFields);
  return Object.freeze({
    survives_controller_restart: expectBoolean(object.survives_controller_restart),
    receipt_recovery: expectBoolean(object.receipt_recovery),
    provider_session_continuity: expectBoolean(object.provider_session_continuity),
  });
}

function expectState(value: BoundedJsonValue): ContextBindingStateCandidateV1 {
  if (typeof value !== "string") refuseJson();
  for (const state of bindingStates) if (value === state) return state;
  return refuseJson();
}

function validateBinding(value: ContextOwnerBindingCandidateV1): void {
  if (value.schema_version !== CONTEXT_OWNER_BINDING_SCHEMA_V1) unsupportedBindingSchema();
  const identifiers: readonly (readonly [BindingIdentifierField, string])[] = [
    ["binding_owner_id", value.owner_id],
    ["binding_owner_version", value.owner_version],
    ["binding_invocation_id", value.invocation_id],
    ["binding_id", value.binding_id],
    ["binding_context_ref", value.context_ref],
    ["binding_instance_id", value.instance_id],
    ["binding_node_kind", value.node_kind],
    ["binding_run_id", value.workflow_run_id],
    ["binding_graph_id", value.graph_id],
    ["binding_node_id", value.node_id],
    ["binding_node_execution_id", value.node_execution_id],
    ["binding_snapshot_id", value.snapshot_id],
    ["binding_approved_revision_id", value.approved_revision_id],
  ];
  for (const [field, identifier] of identifiers) validateIdentifier(field, identifier);
  const digests: readonly (readonly [BindingDigestField, string])[] = [
    ["binding_digest", value.binding_digest],
    ["binding_definition_digest", value.definition_digest],
  ];
  for (const [field, digest] of digests) validateDigest(field, digest);
  validateContextBoundaryCandidate(value.boundary);
  validateGrantsSemantics(value.grants);
  if (
    value.binding_version === 0n ||
    value.lease_epoch === 0n ||
    value.plan_epoch === 0n ||
    value.workflow_run_id !== value.boundary.run_id ||
    (value.state === "available" && !value.grants.metadata_read)
  ) {
    invalidValue("owner_binding");
  }
}

function validateGrantsSemantics(value: ContextBindingGrantsCandidateV1): void {
  if (
    (value.content_read && !value.metadata_read) ||
    (value.edit && !value.content_read) ||
    (value.control && !value.metadata_read)
  ) {
    invalidValue("binding_grants");
  }
}
