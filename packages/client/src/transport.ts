import { ClientError } from "./errors";

export function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function normalizeRelativeBase(baseUrl: string): string {
  if (!baseUrl.startsWith("/")) {
    throw new Error("Studio owner adapters require a same-origin relative API base");
  }
  if (baseUrl.startsWith("//") || baseUrl.includes("\\") || baseUrl.includes("#")) {
    throw new Error("API base contains an unsafe origin or fragment");
  }
  return baseUrl.replace(/\/$/, "");
}

/** Derive the additive v2 root only from an already configured v1 root. This
 * replaces the terminal version segment and preserves the same-origin prefix;
 * it never appends `/v2` beneath `/v1` or accepts an unversioned base. */
export function ownerApiV2BaseFromV1(baseUrl: string): string {
  const normalized = normalizeRelativeBase(baseUrl);
  const segments = normalized.split("/");
  if (normalized.includes("?")
    || normalized.includes("%")
    || normalized.includes("@")
    || segments.length < 2
    || segments[0] !== ""
    || segments[segments.length - 1] !== "v1"
    || segments.slice(1).some((segment) =>
      segment === "" || segment === "." || segment === ".." || !/^[A-Za-z0-9._:-]+$/.test(segment))) {
    throw new ClientError(
      "Owner API v2 requires a same-origin base ending in the exact /v1 segment",
      "invalid_api_base_version",
    );
  }
  const prefix = normalized.slice(0, -"/v1".length);
  return prefix.length === 0 ? "/v2" : `${prefix}/v2`;
}

export function encodeIdentifier(value: string): string {
  if (!/^[A-Za-z0-9._:-]+$/.test(value)) {
    throw new ClientError("Identifier contains unsupported characters", "invalid_identifier");
  }
  return encodeURIComponent(value);
}

/** Keep admitted v2 run IDs literal in the request target: Harness rejects `%`
 * before routing, so percent-encoding the legal colon would make a valid ID
 * unreadable. The raw path parser also refuses any `..` substring. */
export function seedRunIdV2PathSegment(value: string): string {
  if (value.length > 128
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)
    || value.includes("..")) {
    throw new ClientError("Workflow run ID is not an admitted v2 path segment", "invalid_identifier");
  }
  return value;
}

/** Encodes ONE path segment for the owner's inference-profile routes.
 *
 * This deliberately does not reuse `encodeIdentifier`, and the difference is
 * load-bearing rather than stylistic.
 *
 * The owner's request parser (`crates/harness/src/management/http_parse.rs`,
 * `parse_target`) REJECTS any request target containing `%` outright:
 *
 * ```rust
 * if !target.starts_with('/')
 *     || target.starts_with("//")
 *     || target.contains("\\")
 *     || target.contains("..")
 *     || target.contains('@')
 *     || target.contains('#')
 *     || target.contains('%')
 * { return Err(HttpError::new("invalid_path", ...)); }
 * ```
 *
 * It then splits the raw path on `/` and never percent-decodes it. So a
 * percent-encoded segment is not merely decoded differently — it is refused
 * before routing. `encodeURIComponent("decision.live:v1")` yields
 * `decision.live%3Av1`, which the owner rejects as `invalid_path`.
 *
 * The producer's own `validate_identifier` for `profile_id` admits
 * `[A-Za-z0-9][A-Za-z0-9._:-]*`, and a colon is legal and load-bearing: the
 * adopted reference is `profile_id:version:digest`. Such an id must therefore
 * travel as its literal characters.
 *
 * The character class below is therefore restricted to exactly what
 * `validate_identifier` permits AND what `parse_target` lets through the
 * parser: `.`, `_`, `:` and `-` are kept literal, while `/` (a segment escape),
 * `?` (a query escape), `#` (a fragment escape), `%` (refused by the owner),
 * `\` and `..` (refused by the owner) are refused here rather than encoded.
 * A rejected value never reaches the network at all. */
export function encodeProfileIdSegment(profileId: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(profileId)) {
    throw new ClientError(
      "Inference profile id is not a single admitted path segment",
      "invalid_identifier",
    );
  }
  return profileId;
}

export function cryptoRandomId(): string {
  const bytes = new Uint8Array(12);
  globalThis.crypto?.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

export function isLiveExecutionProfile(profile: string): boolean {
  return profile === "live" || profile.startsWith("live.");
}
