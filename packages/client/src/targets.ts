import type {
  RunTargetConfiguration,
  TargetAdmissionBinding,
  TargetAdmissionRequest,
  TargetDescriptor,
} from "@studio/contracts";

import { CapabilityGateError, ClientError } from "./errors";

export const TARGET_CONFIGURATION_FIELDS: (keyof RunTargetConfiguration)[] = [
  "instance_id",
  "execution_profile",
  "execution_mode",
  "workflow_revision",
  "compatibility_revision",
  "capability_revision",
  "game_profile",
  "save_profile",
  "inference_profile",
  "context_capability",
  "provider_capability",
];

function bindingMismatch(path: string, detail: string): never {
  throw new ClientError(`Target admission binding ${path} ${detail}`, "target_binding_mismatch", 409);
}

export function assertEqualBindingField(path: string, actual: unknown, expected: unknown): void {
  if (actual !== expected) {
    bindingMismatch(path, `does not match the reviewed value (${String(expected)}).`);
  }
}

/**
 * Check that an owner-issued admission is the exact response to the request
 * that the Studio reviewed. Every target/profile field is compared, including
 * nullable optional profile and capability fields.
 */
export function validateTargetAdmissionBinding(
  admission: TargetAdmissionBinding,
  request: TargetAdmissionRequest,
): void {
  assertEqualBindingField("schema_version", admission.schema_version, request.schema_version);
  assertEqualBindingField("request_id", admission.request_id, request.request_id);
  assertEqualBindingField("workflow_definition_digest", admission.workflow_definition_digest, request.workflow_definition_digest);
  for (const field of TARGET_CONFIGURATION_FIELDS) {
    assertEqualBindingField(`target.${field}`, admission.target[field], request.target[field]);
  }
}

/**
 * Validate a selected target descriptor against every exact target/profile
 * binding. This is a local preflight guard only; the owner remains the
 * authority and must perform the same checks.
 */
export function validateTargetConfiguration(
  descriptor: TargetDescriptor,
  target: RunTargetConfiguration,
): void {
  if (descriptor.availability !== "available") {
    throw new CapabilityGateError(`Target ${descriptor.instance_id} is ${descriptor.availability}.`, "target_unavailable");
  }
  assertEqualBindingField("target.instance_id", target.instance_id, descriptor.instance_id);
  if (!descriptor.execution_profiles.includes(target.execution_profile)) {
    bindingMismatch("target.execution_profile", `is not supported by ${descriptor.instance_id}.`);
  }
  assertEqualBindingField("target.execution_mode", target.execution_mode, descriptor.execution_mode);
  if (target.execution_mode === "live" && !descriptor.supported_operations.includes("workflow:live")) {
    throw new CapabilityGateError(
      `Target ${descriptor.instance_id} does not advertise workflow:live.`,
      "target_operation_unavailable",
    );
  }
  assertEqualBindingField("target.compatibility_revision", target.compatibility_revision, descriptor.compatibility_revision);
  assertEqualBindingField("target.capability_revision", target.capability_revision, descriptor.capability_revision);
  if (!descriptor.game_profiles.includes(target.game_profile)) {
    bindingMismatch("target.game_profile", `is not supported by ${descriptor.instance_id}.`);
  }
  if (target.save_profile !== null && !descriptor.save_profiles.includes(target.save_profile)) {
    bindingMismatch("target.save_profile", `is not supported by ${descriptor.instance_id}.`);
  }
  if (target.inference_profile !== null && !descriptor.inference_profiles.includes(target.inference_profile)) {
    bindingMismatch("target.inference_profile", `is not supported by ${descriptor.instance_id}.`);
  }
  if (target.context_capability !== null && !descriptor.capabilities.includes(target.context_capability)) {
    bindingMismatch("target.context_capability", `is not advertised by ${descriptor.instance_id}.`);
  }
  if (target.provider_capability !== null && !descriptor.capabilities.includes(target.provider_capability)) {
    bindingMismatch("target.provider_capability", `is not advertised by ${descriptor.instance_id}.`);
  }
}
