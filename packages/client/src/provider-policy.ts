import type { ProviderSessionPolicyCommandResponse } from "@studio/contracts";

import { ClientError } from "./errors";

export const MAX_POLICY_UPLOAD_BYTES = 1_048_576;

export function assertPolicyUpload(bytes: ArrayBuffer): void {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_POLICY_UPLOAD_BYTES) {
    throw new ClientError(
      `Policy upload must contain 1 to ${MAX_POLICY_UPLOAD_BYTES} bytes`,
      "provider_session_policy_upload_size",
    );
  }
}

export function assertPolicyCommandOperation(
  response: ProviderSessionPolicyCommandResponse,
  expected: ProviderSessionPolicyCommandResponse["operation"],
): ProviderSessionPolicyCommandResponse {
  if (response.operation !== expected) {
    throw new ClientError(
      "Provider-session policy owner returned a different command operation",
      "provider_session_policy_operation_mismatch",
      409,
    );
  }
  return response;
}

export function policyRevisionQuery(revision: number): string {
  if (!Number.isSafeInteger(revision) || revision <= 0) {
    throw new ClientError("Policy owner revision must be a positive safe integer", "invalid_revision");
  }
  return new URLSearchParams({ expected_revision: String(revision) }).toString();
}
