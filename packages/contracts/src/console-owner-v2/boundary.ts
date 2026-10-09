import { parseBoundedJson } from "./lossless-json";
import { expectClosedObject, expectString, expectU64 } from "./json-token";
import {
  invalidValue,
  validateDigest,
  validateIdentifier,
  type BoundaryDigestField,
  type BoundaryIdentifierField,
} from "./wire-scalars";

export interface ContextBoundaryCandidateV2 {
  readonly run_id: string;
  readonly episode_id: string;
  readonly agent_id: string;
  readonly state_id: string;
  readonly generation: bigint;
  readonly observation_sha256: string;
  readonly catalog_sha256: string;
  readonly adapter_revision: string;
  readonly model_revision: string;
  readonly configuration_sha256: string;
  readonly output_schema_sha256: string;
  readonly controller_epoch: bigint;
  readonly gate_epoch: bigint;
  readonly control_version: bigint;
}

export interface UntrustedContextBoundaryCandidateV2 {
  readonly kind: "untrusted_context_boundary_v2";
  readonly trust: "untrusted";
  readonly authority: "none";
  readonly boundary: ContextBoundaryCandidateV2;
}

const boundaryFields = [
  "run_id",
  "episode_id",
  "agent_id",
  "state_id",
  "generation",
  "observation_sha256",
  "catalog_sha256",
  "adapter_revision",
  "model_revision",
  "configuration_sha256",
  "output_schema_sha256",
  "controller_epoch",
  "gate_epoch",
  "control_version",
] as const;

/** Decode only the claimed top-level ContextBoundary; this frozen candidate is not trusted. */
export function decodeContextBoundaryV2Candidate(input: Uint8Array): UntrustedContextBoundaryCandidateV2 {
  const document = parseBoundedJson(input);
  const object = expectClosedObject(document.value, boundaryFields);
  const boundary = Object.freeze({
    run_id: expectString(object.run_id),
    episode_id: expectString(object.episode_id),
    agent_id: expectString(object.agent_id),
    state_id: expectString(object.state_id),
    generation: expectU64(object.generation),
    observation_sha256: expectString(object.observation_sha256),
    catalog_sha256: expectString(object.catalog_sha256),
    adapter_revision: expectString(object.adapter_revision),
    model_revision: expectString(object.model_revision),
    configuration_sha256: expectString(object.configuration_sha256),
    output_schema_sha256: expectString(object.output_schema_sha256),
    controller_epoch: expectU64(object.controller_epoch),
    gate_epoch: expectU64(object.gate_epoch),
    control_version: expectU64(object.control_version),
  });
  validateBoundary(boundary);
  return Object.freeze({
    kind: "untrusted_context_boundary_v2",
    trust: "untrusted",
    authority: "none",
    boundary,
  });
}

function validateBoundary(value: ContextBoundaryCandidateV2): void {
  const identifiers: readonly (readonly [BoundaryIdentifierField, string])[] = [
    ["boundary_run_id", value.run_id],
    ["boundary_episode_id", value.episode_id],
    ["boundary_agent_id", value.agent_id],
    ["boundary_state_id", value.state_id],
    ["boundary_adapter_revision", value.adapter_revision],
    ["boundary_model_revision", value.model_revision],
  ];
  for (const [field, identifier] of identifiers) validateIdentifier(field, identifier);

  const digests: readonly (readonly [BoundaryDigestField, string])[] = [
    ["boundary_observation_sha256", value.observation_sha256],
    ["boundary_catalog_sha256", value.catalog_sha256],
    ["boundary_configuration_sha256", value.configuration_sha256],
    ["boundary_output_schema_sha256", value.output_schema_sha256],
  ];
  for (const [field, digest] of digests) validateDigest(field, digest);

  if (
    value.generation === 0n ||
    value.controller_epoch === 0n ||
    value.gate_epoch === 0n ||
    value.control_version === 0n
  ) {
    invalidValue("boundary_epoch");
  }
}
