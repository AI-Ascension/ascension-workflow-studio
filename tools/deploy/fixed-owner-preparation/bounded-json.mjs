// SPDX-License-Identifier: MIT
// @ts-check

/** @typedef {import("./untrusted-envelope.js").PreparationRefusalCode} PreparationRefusalCode */

export const MAX_CONFIG_BYTES = 16 * 1024;
export const MAX_JSON_BODY_BYTES = 1024 * 1024;
export const MAX_JSON_DEPTH = 32;

const TYPED_ARRAY_BYTE_LENGTH = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype),
  "byteLength",
)?.get;
const TYPED_ARRAY_SET = Uint8Array.prototype.set;

/** A refusal contains only a fixed code; it never stores input bytes or text. */
export class PreparationRefusal extends Error {
  /** @param {PreparationRefusalCode} code */
  constructor(code) {
    super(code);
    this.code = code;
  }
}

Object.defineProperty(PreparationRefusal.prototype, "name", {
  value: "PreparationRefusal",
  writable: true,
  configurable: true,
});

/** @param {PreparationRefusalCode} code @returns {never} */
export function refuse(code) {
  throw new PreparationRefusal(code);
}

/**
 * Validates JSON object shape without creating a body value tree.
 * @param {Uint8Array} bytes
 */
export function validateBoundedJsonObject(bytes) {
  scanBoundedJson(bytes, MAX_JSON_BODY_BYTES, "json_too_large");
}

/**
 * Decodes an object under the JSON-body cap. Configuration uses the stricter
 * config-specific parser, while request bodies use the syntax-only validator.
 * @param {Uint8Array} bytes
 * @returns {Record<string, unknown>}
 */
export function parseBoundedJsonObject(bytes) {
  return parseScannedObject(bytes, MAX_JSON_BODY_BYTES, "json_too_large");
}

/**
 * Parses the closed local configuration under its tighter byte cap.
 * @param {Uint8Array} bytes
 * @returns {Record<string, unknown>}
 */
export function parseBoundedConfigObject(bytes) {
  return parseScannedObject(bytes, MAX_CONFIG_BYTES, "config_too_large");
}

/**
 * @param {Uint8Array} bytes
 * @param {number} maxBytes
 * @param {PreparationRefusalCode} sizeRefusalCode
 * @returns {Record<string, unknown>}
 */
function parseScannedObject(bytes, maxBytes, sizeRefusalCode) {
  const text = scanBoundedJson(bytes, maxBytes, sizeRefusalCode);
  try {
    const value = JSON.parse(text);
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      refuse("json_root_required");
    }
    return /** @type {Record<string, unknown>} */ (value);
  } catch (error) {
    if (error instanceof PreparationRefusal) throw error;
    refuse("invalid_json");
  }
}

/**
 * Copies the actual typed-array view bytes into bounded native storage without
 * consulting caller-overridable byteLength, subarray, iterator, or copy hooks.
 * @param {Uint8Array} bytes
 * @param {number} maxBytes
 * @param {PreparationRefusalCode} sizeRefusalCode
 * @returns {Uint8Array}
 */
function snapshotBoundedBytes(bytes, maxBytes, sizeRefusalCode) {
  if (!(bytes instanceof Uint8Array)) refuse("invalid_input");
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) refuse("invalid_input");
  if (typeof TYPED_ARRAY_BYTE_LENGTH !== "function") refuse("invalid_input");

  /** @type {number} */
  let byteLength;
  try {
    byteLength = Reflect.apply(TYPED_ARRAY_BYTE_LENGTH, bytes, []);
  } catch {
    refuse("invalid_input");
  }
  if (!Number.isSafeInteger(byteLength) || byteLength < 0) refuse("invalid_input");
  if (byteLength > maxBytes) refuse(sizeRefusalCode);

  const owned = new Uint8Array(byteLength);
  try {
    Reflect.apply(TYPED_ARRAY_SET, owned, [bytes]);
  } catch {
    refuse("invalid_input");
  }
  return owned;
}

/**
 * @param {Uint8Array} bytes
 * @param {number} maxBytes
 * @param {PreparationRefusalCode} sizeRefusalCode
 * @returns {string}
 */
function scanBoundedJson(bytes, maxBytes, sizeRefusalCode) {
  const owned = snapshotBoundedBytes(bytes, maxBytes, sizeRefusalCode);

  /** @type {string} */
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(owned);
  } catch {
    refuse("invalid_utf8");
  }

  const maxNodes = owned.byteLength + 1;
  if (!Number.isSafeInteger(maxNodes)) refuse("json_node_limit");
  new JsonShapeScanner(text, maxNodes).scanObjectRoot();
  return text;
}

class JsonShapeScanner {
  /** @param {string} text @param {number} maxNodes */
  constructor(text, maxNodes) {
    this.text = text;
    this.maxNodes = maxNodes;
    this.index = 0;
    this.nodes = 0;
  }

  scanObjectRoot() {
    this.skipWhitespace();
    if (this.text[this.index] !== "{") refuse("json_root_required");
    this.scanValue(1);
    this.skipWhitespace();
    if (this.index !== this.text.length) refuse("invalid_json");
  }

  /** @param {number} depth */
  scanValue(depth) {
    if (depth > MAX_JSON_DEPTH) refuse("json_too_deep");
    const nextNodeCount = this.nodes + 1;
    if (!Number.isSafeInteger(nextNodeCount) || nextNodeCount > this.maxNodes) {
      refuse("json_node_limit");
    }
    this.nodes = nextNodeCount;

    const next = this.text[this.index];
    if (next === "{") return this.scanObject(depth);
    if (next === "[") return this.scanArray(depth);
    if (next === "\"") {
      this.scanString(false);
      return;
    }
    if (next === "t") return this.scanLiteral("true");
    if (next === "f") return this.scanLiteral("false");
    if (next === "n") return this.scanLiteral("null");
    if (next === "-" || isDigit(next)) return this.scanNumber();
    refuse("invalid_json");
  }

  /** @param {number} depth */
  scanObject(depth) {
    this.index += 1;
    this.skipWhitespace();
    if (this.text[this.index] === "}") {
      this.index += 1;
      return;
    }

    /** @type {Set<string>} */
    const keys = new Set();
    while (true) {
      if (this.text[this.index] !== "\"") refuse("invalid_json");
      const key = this.scanString(true);
      if (key === null) refuse("invalid_json");
      if (keys.has(key)) refuse("duplicate_json_key");
      keys.add(key);
      this.skipWhitespace();
      if (this.text[this.index] !== ":") refuse("invalid_json");
      this.index += 1;
      this.skipWhitespace();
      this.scanValue(depth + 1);
      this.skipWhitespace();
      if (this.text[this.index] === "}") {
        this.index += 1;
        return;
      }
      if (this.text[this.index] !== ",") refuse("invalid_json");
      this.index += 1;
      this.skipWhitespace();
    }
  }

  /** @param {number} depth */
  scanArray(depth) {
    this.index += 1;
    this.skipWhitespace();
    if (this.text[this.index] === "]") {
      this.index += 1;
      return;
    }
    while (true) {
      this.scanValue(depth + 1);
      this.skipWhitespace();
      if (this.text[this.index] === "]") {
        this.index += 1;
        return;
      }
      if (this.text[this.index] !== ",") refuse("invalid_json");
      this.index += 1;
      this.skipWhitespace();
    }
  }

  /** @param {boolean} decode @returns {string | null} */
  scanString(decode) {
    const start = this.index;
    this.index += 1;
    while (this.index < this.text.length) {
      const code = this.text.charCodeAt(this.index);
      if (code === 0x22) {
        this.index += 1;
        if (!decode) return null;
        try {
          return /** @type {string} */ (JSON.parse(this.text.slice(start, this.index)));
        } catch {
          refuse("invalid_json");
        }
      }
      if (code < 0x20) refuse("invalid_json");
      if (code !== 0x5c) {
        this.index += 1;
        continue;
      }

      const escape = this.text[this.index + 1];
      if (escape === undefined) refuse("invalid_json");
      if ('"\\/bfnrt'.includes(escape)) {
        this.index += 2;
        continue;
      }
      if (escape !== "u") refuse("invalid_json");
      const first = this.readHexQuad(this.index + 2);
      this.index += 6;
      if (first >= 0xd800 && first <= 0xdbff) {
        if (this.text.slice(this.index, this.index + 2) !== "\\u") refuse("invalid_json");
        const second = this.readHexQuad(this.index + 2);
        if (second < 0xdc00 || second > 0xdfff) refuse("invalid_json");
        this.index += 6;
      } else if (first >= 0xdc00 && first <= 0xdfff) {
        refuse("invalid_json");
      }
    }
    refuse("invalid_json");
  }

  /** @param {number} start @returns {number} */
  readHexQuad(start) {
    const digits = this.text.slice(start, start + 4);
    if (digits.length !== 4 || !/^[0-9a-fA-F]{4}$/.test(digits)) refuse("invalid_json");
    return Number.parseInt(digits, 16);
  }

  /** @param {string} literal */
  scanLiteral(literal) {
    if (!this.text.startsWith(literal, this.index)) refuse("invalid_json");
    this.index += literal.length;
  }

  scanNumber() {
    if (this.text[this.index] === "-") this.index += 1;
    const integerStart = this.index;
    if (this.text[this.index] === "0") {
      this.index += 1;
      if (isDigit(this.text[this.index])) refuse("invalid_json");
    } else if (isNonzeroDigit(this.text[this.index])) {
      this.index += 1;
      while (isDigit(this.text[this.index])) this.index += 1;
    } else {
      refuse("invalid_json");
    }
    if (this.index === integerStart) refuse("invalid_json");

    if (this.text[this.index] === ".") {
      this.index += 1;
      const fractionStart = this.index;
      while (isDigit(this.text[this.index])) this.index += 1;
      if (this.index === fractionStart) refuse("invalid_json");
    }
    if (this.text[this.index] === "e" || this.text[this.index] === "E") {
      this.index += 1;
      if (this.text[this.index] === "+" || this.text[this.index] === "-") this.index += 1;
      const exponentStart = this.index;
      while (isDigit(this.text[this.index])) this.index += 1;
      if (this.index === exponentStart) refuse("invalid_json");
    }
  }

  skipWhitespace() {
    while ([" ", "\t", "\r", "\n"].includes(this.text[this.index])) this.index += 1;
  }
}

/** @param {string | undefined} value */
function isDigit(value) {
  return value !== undefined && value >= "0" && value <= "9";
}

/** @param {string | undefined} value */
function isNonzeroDigit(value) {
  return value !== undefined && value >= "1" && value <= "9";
}
