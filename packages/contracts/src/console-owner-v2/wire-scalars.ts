export const MAX_OWNER_JSON_BODY_BYTES = 1024 * 1024;
export const MAX_OWNER_JSON_DEPTH = 32;
export const MAX_U64_DECIMAL_DIGITS = 20;
export const MAX_U64 = 18_446_744_073_709_551_615n;

export type IdentityField =
  | "console_issuer"
  | "console_audience"
  | "console_credential_id"
  | "console_subject"
  | "console_grant_id"
  | "console_project_id"
  | "console_run_id"
  | "console_episode_id"
  | "console_agent_id"
  | "harness_actor_subject"
  | "harness_owner_id"
  | "harness_workflow_run_id"
  | "harness_credential_reference_id"
  | "console_grant_lifetime"
  | "harness_credential_expiry"
  | "actor_subject"
  | "workflow_run_id";

export type CandidateRefusal =
  | Readonly<{ kind: "json_decoding" }>
  | Readonly<{ kind: "out_of_bounds"; field: "json_body" | "json_shape" }>
  | Readonly<{ kind: "invalid_identifier"; field: IdentityField }>
  | Readonly<{ kind: "invalid_value"; field: IdentityField }>
  | Readonly<{ kind: "correlation_mismatch"; field: IdentityField }>;

/** Fixed, value-free refusal categories for this untrusted candidate decoder. */
export class OwnerIdentityCandidateError extends Error {
  readonly refusal: CandidateRefusal;

  constructor(refusal: CandidateRefusal) {
    const safe = Object.freeze({ ...refusal }) as CandidateRefusal;
    super("field" in safe ? `${safe.kind}:${safe.field}` : safe.kind);
    this.name = "OwnerIdentityCandidateError";
    this.refusal = safe;
  }
}

export function refuseJson(): never {
  throw new OwnerIdentityCandidateError({ kind: "json_decoding" });
}

export function validateIdentifier(field: IdentityField, value: string): void {
  if (value.length === 0 || value.length > 128) invalidIdentifier(field);
  const first = value.charCodeAt(0);
  if (!isAsciiAlphaNumeric(first)) invalidIdentifier(field);
  for (let index = 1; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (!isAsciiAlphaNumeric(code) && code !== 0x2e && code !== 0x5f && code !== 0x3a && code !== 0x2d) {
      invalidIdentifier(field);
    }
  }
}

export function validateCorrelationText(field: IdentityField, value: string): void {
  if (value.length === 0 || !isUnicodeScalarString(value)) invalidIdentifier(field);
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) invalidIdentifier(field);
    if (code <= 0x7f) bytes += 1;
    else if (code <= 0x7ff) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4;
      index += 1;
    } else bytes += 3;
    if (bytes > 512) invalidIdentifier(field);
  }
}

export function invalidIdentifier(field: IdentityField): never {
  throw new OwnerIdentityCandidateError({ kind: "invalid_identifier", field });
}

export function invalidValue(field: IdentityField): never {
  throw new OwnerIdentityCandidateError({ kind: "invalid_value", field });
}

export function correlationMismatch(field: IdentityField): never {
  throw new OwnerIdentityCandidateError({ kind: "correlation_mismatch", field });
}

function isAsciiAlphaNumeric(code: number): boolean {
  return (code >= 0x30 && code <= 0x39) || (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a);
}

function isUnicodeScalarString(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (index + 1 >= value.length || next < 0xdc00 || next > 0xdfff) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}
