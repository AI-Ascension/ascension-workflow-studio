import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { parseBoundedJson } from "@studio/document";
import type { JsonValue } from "@studio/contracts";

export const limits = {
  archive: 16 * 1024 * 1024, extracted: 32 * 1024 * 1024,
  entry: 16 * 1024 * 1024, manifest: 256 * 1024, report: 1024 * 1024,
  entries: 32, records: 25_000, line: 64 * 1024,
} as const;

export class ImportFailure extends Error {
  constructor(public readonly code: string, message: string) { super(message); }
}
export function requireImport(condition: unknown, code: string, message: string): asserts condition {
  if (!condition) throw new ImportFailure(code, message);
}
export const digest = (bytes: Uint8Array): string => bytesToHex(sha256(bytes));
export const encode = (text: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(text);
export function decode(bytes: Uint8Array): string {
  try {
    requireImport(!(bytes[0] === 239 && bytes[1] === 187 && bytes[2] === 191), "invalid_json", "UTF-8 BOM is not supported.");
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch { throw new ImportFailure("invalid_json", "Input must be valid UTF-8 without a BOM."); }
}
function validString(value: string): string {
  for (let i = 0; i < value.length; i++) {
    const unit = value.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(++i);
      requireImport(next >= 0xdc00 && next <= 0xdfff, "invalid_json", "Unpaired Unicode surrogate.");
    } else requireImport(unit < 0xdc00 || unit > 0xdfff, "invalid_json", "Unpaired Unicode surrogate.");
  }
  return JSON.stringify(value);
}
/** RFC 8785 member emission, independent from workflow semantic canonicalization. */
export function jcs(value: JsonValue): string {
  if (typeof value === "string") return validString(value);
  if (typeof value === "number") {
    requireImport(Number.isFinite(value), "invalid_json", "Non-finite JSON number.");
    return JSON.stringify(value);
  }
  if (value === null || typeof value === "boolean") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(jcs).join(",")}]`;
  return `{${Object.keys(value).sort().map(key => `${validString(key)}:${jcs(value[key])}`).join(",")}}`;
}
export function canonicalDocument(bytes: Uint8Array, maxBytes: number): JsonValue {
  requireImport(bytes.byteLength <= maxBytes, "resource_limit", "JSON document exceeds the supported byte limit.");
  const raw = decode(bytes);
  let nesting = 0, quoted = false, escaped = false;
  for (const character of raw) {
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
    } else if (character === '"') quoted = true;
    else if (character === "[" || character === "{") requireImport(++nesting <= 32, "resource_limit", "JSON exceeds 32 nested containers.");
    else if (character === "]" || character === "}") nesting--;
  }
  let value: JsonValue;
  try {
    value = parseBoundedJson(raw, { maxBytes, maxDepth: 32, maxNodes: 100_000, maxStringBytes: maxBytes });
  } catch { throw new ImportFailure("invalid_json", "JSON is malformed, contains duplicate keys, or exceeds structural limits."); }
  requireImport(jcs(value) === raw, "noncanonical_json", "JSON bytes do not match canonical JCS serialization.");
  return value;
}
