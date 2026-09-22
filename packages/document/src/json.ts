import type { JsonObject, JsonValue } from "@studio/contracts";

export function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function isJsonRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function toJsonValueOrUndefined(value: unknown): JsonValue | undefined {
  return value === undefined ? undefined : canonicalize(value);
}

export function sameJson(first: unknown, second: unknown): boolean {
  if (first === undefined || second === undefined) return first === second;
  return canonicalJson(first) === canonicalJson(second);
}

/**
 * Canonical JSON that retains the `annotations` field. The owner's authoritative
 * definition digest is computed over the complete definition (including
 * annotations), so run admission and run pinning must use this rather than the
 * annotation-insensitive semantic identity.
 */
export function canonicalJsonComplete(value: unknown): string {
  return stringifyCanonicalComplete(value);
}

/**
 * Serializes in explicit lexical key order. `JSON.stringify` would silently
 * reorder integer-like keys numerically, which does not match the owner's
 * lexically ordered JSON maps, so object keys are emitted directly rather than
 * relying on property enumeration.
 */
function stringifyCanonicalComplete(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("canonical JSON does not permit non-finite numbers");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stringifyCanonicalComplete(item)).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const body = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stringifyCanonicalComplete(record[key])}`)
      .join(",");
    return `{${body}}`;
  }
  throw new Error("canonical JSON contains an unsupported value");
}

export function canonicalize(value: unknown): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("canonical JSON does not permit non-finite numbers");
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item));
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const output = Object.create(null) as JsonObject;
    for (const key of Object.keys(record).sort()) {
      if (key === "annotations") {
        continue;
      }
      output[key] = canonicalize(record[key]);
    }
    return output;
  }
  throw new Error("canonical JSON contains an unsupported value");
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}
