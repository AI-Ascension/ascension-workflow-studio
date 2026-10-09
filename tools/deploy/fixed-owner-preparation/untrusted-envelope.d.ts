// SPDX-License-Identifier: MIT

export type PreparedRoute = "invoke" | "receipt_lookup" | "cached_result";

export type PreparationRefusalCode =
  | "invalid_input"
  | "config_too_large"
  | "invalid_config"
  | "unknown_config_field"
  | "invalid_host"
  | "invalid_origin"
  | "invalid_utf8"
  | "invalid_json"
  | "duplicate_json_key"
  | "json_root_required"
  | "json_too_large"
  | "json_too_deep"
  | "json_node_limit"
  | "frame_too_large"
  | "header_too_large"
  | "body_too_large"
  | "invalid_frame"
  | "invalid_header"
  | "too_many_headers"
  | "forbidden_header"
  | "forbidden_principal_header"
  | "duplicate_authority_header"
  | "invalid_content_length"
  | "transfer_encoding_forbidden"
  | "method_not_allowed"
  | "route_not_found"
  | "host_mismatch"
  | "origin_mismatch"
  | "invalid_bearer";

export interface PreparedConfig {
  readonly schema_version: "studio.console-owner-preparation.v1";
  readonly mode: "prepare_only";
  readonly expected_host: string;
  readonly expected_origin: string | null;
}

declare const untrustedPreparedEnvelopeBrand: unique symbol;

export interface UntrustedPreparedEnvelope {
  readonly [untrustedPreparedEnvelopeBrand]: true;
  readonly kind: "untrusted_console_envelope";
  readonly trust: "untrusted";
  readonly authority: "none";
  readonly route: PreparedRoute;
  readonly body: Uint8Array;
  readonly host: string;
  readonly origin: string | null;
  readonly credentialPresence: {
    readonly bearer: true;
    readonly csrf: boolean;
  };
}
