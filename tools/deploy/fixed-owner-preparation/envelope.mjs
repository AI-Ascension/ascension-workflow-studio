// SPDX-License-Identifier: MIT
// @ts-check

/** @typedef {import("./untrusted-envelope.js").PreparedConfig} PreparedConfig */
/** @typedef {import("./untrusted-envelope.js").PreparedRoute} PreparedRoute */
/** @typedef {import("./untrusted-envelope.js").UntrustedPreparedEnvelope} UntrustedPreparedEnvelope */

import {
  MAX_HOST_BYTES,
  MAX_ORIGIN_BYTES,
  validatePreparationConfig,
} from "./config.mjs";
import {
  MAX_JSON_BODY_BYTES,
  PreparationRefusal,
  refuse,
  validateBoundedJsonObject,
} from "./bounded-json.mjs";
import { resolvePreparationRoute } from "./routes.mjs";

export const MAX_HEADER_BYTES = 8 * 1024;
export const MAX_BODY_BYTES = MAX_JSON_BODY_BYTES;
export const MAX_REQUEST_BYTES = MAX_HEADER_BYTES + MAX_BODY_BYTES;
export const MAX_TARGET_BYTES = 4096;
export const MAX_HEADER_COUNT = 32;
export const MAX_HEADER_NAME_BYTES = 64;
export const MAX_HEADER_VALUE_BYTES = 2048;
export const MAX_TOKEN_BYTES = 2048;

const CRLFCRLF = Uint8Array.of(13, 10, 13, 10);
const CRLF = Uint8Array.of(13, 10);
const TYPED_ARRAY_BYTE_LENGTH = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype),
  "byteLength",
)?.get;
const TYPED_ARRAY_SET = Uint8Array.prototype.set;

/**
 * Parses a complete HTTP/1.1 request frame. The result is untrusted input and
 * deliberately has no transport, response, authentication, or disclosure API.
 * @param {Uint8Array} rawFrame
 * @param {PreparedConfig} suppliedConfig
 * @returns {UntrustedPreparedEnvelope}
 */
export function parsePreparationEnvelope(rawFrame, suppliedConfig) {
  if (!(rawFrame instanceof Uint8Array)) refuse("invalid_input");
  const frame = snapshotFrame(rawFrame);
  const config = validatePreparationConfig(suppliedConfig);

  const separator = findSequence(frame, CRLFCRLF, 0, frame.byteLength);
  if (separator < 0) {
    if (frame.byteLength > MAX_HEADER_BYTES) refuse("header_too_large");
    refuse("invalid_frame");
  }
  const headerEnd = separator + CRLFCRLF.byteLength;
  if (headerEnd > MAX_HEADER_BYTES) refuse("header_too_large");

  const firstLineEnd = findSequence(frame, CRLF, 0, separator);
  if (firstLineEnd < 0) refuse("invalid_frame");
  const requestLine = parseRequestLine(frame.subarray(0, firstLineEnd));
  if (requestLine.method !== "POST") refuse("method_not_allowed");
  if (requestLine.target.byteLength > MAX_TARGET_BYTES) refuse("frame_too_large");
  const target = decodeTarget(requestLine.target);
  const route = resolvePreparationRoute(requestLine.method, target);
  if (route === null) refuse("route_not_found");

  const headers = parseHeaders(frame, firstLineEnd + CRLF.byteLength, separator);
  const host = singleHeader(headers, "host", true);
  const origin = singleHeader(headers, "origin", false);
  const authorization = singleHeader(headers, "authorization", true);
  const csrf = singleHeader(headers, "x-csrf-token", false);
  if (headers.has("x-principal")) refuse("forbidden_principal_header");
  if (hasForwardedAuthority(headers)) refuse("forbidden_header");
  if (host !== null && byteLength(host) > MAX_HOST_BYTES) refuse("invalid_header");
  if (origin !== null && byteLength(origin) > MAX_ORIGIN_BYTES) refuse("invalid_header");
  if (host !== config.expected_host) refuse("host_mismatch");
  if (config.expected_origin === null ? origin !== null : origin !== config.expected_origin) {
    refuse("origin_mismatch");
  }

  validateBearer(authorization);
  if (csrf !== null && byteLength(csrf) > MAX_TOKEN_BYTES) refuse("invalid_header");

  if (headers.has("transfer-encoding")) refuse("transfer_encoding_forbidden");
  const contentLengths = headers.get("content-length") ?? [];
  if (contentLengths.length !== 1) refuse("invalid_content_length");
  const bodyLength = parseContentLength(contentLengths[0]);
  if (bodyLength > MAX_BODY_BYTES) refuse("body_too_large");
  if (headerEnd > Number.MAX_SAFE_INTEGER - bodyLength) refuse("frame_too_large");
  const expectedLength = headerEnd + bodyLength;
  if (frame.byteLength !== expectedLength) refuse("invalid_frame");

  const rawBody = frame.subarray(headerEnd, expectedLength);
  validateBoundedJsonObject(rawBody);
  const bodyCopy = Uint8Array.from(rawBody);
  const credentialPresence = Object.freeze({ bearer: true, csrf: csrf !== null });
  /** @type {UntrustedPreparedEnvelope} */
  const result = /** @type {UntrustedPreparedEnvelope} */ ({
    kind: "untrusted_console_envelope",
    trust: "untrusted",
    authority: "none",
    route: /** @type {PreparedRoute} */ (route),
    body: bodyCopy,
    host,
    origin,
    credentialPresence,
  });
  return Object.freeze(result);
}

/** @param {Uint8Array} source @returns {Uint8Array} */
function snapshotFrame(source) {
  if (typeof TYPED_ARRAY_BYTE_LENGTH !== "function") refuse("invalid_input");

  /** @type {number} */
  let byteLength;
  try {
    byteLength = Reflect.apply(TYPED_ARRAY_BYTE_LENGTH, source, []);
  } catch {
    refuse("invalid_input");
  }
  if (!Number.isSafeInteger(byteLength) || byteLength > MAX_REQUEST_BYTES) {
    refuse("frame_too_large");
  }

  const owned = new Uint8Array(byteLength);
  try {
    Reflect.apply(TYPED_ARRAY_SET, owned, [source]);
  } catch {
    refuse("invalid_input");
  }
  return owned;
}

/** @param {Uint8Array} bytes @param {Uint8Array} sequence @param {number} start @param {number} end */
function findSequence(bytes, sequence, start, end) {
  for (let index = start; index <= end - sequence.byteLength; index += 1) {
    let matches = true;
    for (let offset = 0; offset < sequence.byteLength; offset += 1) {
      if (bytes[index + offset] !== sequence[offset]) {
        matches = false;
        break;
      }
    }
    if (matches) return index;
  }
  return -1;
}

/** @param {Uint8Array} line */
function parseRequestLine(line) {
  let firstSpace = -1;
  let secondSpace = -1;
  for (let index = 0; index < line.byteLength; index += 1) {
    const byte = line[index];
    if (byte < 0x21 || byte > 0x7e) {
      if (byte !== 0x20) refuse("invalid_frame");
      if (firstSpace < 0) firstSpace = index;
      else if (secondSpace < 0) secondSpace = index;
      else refuse("invalid_frame");
    }
  }
  if (firstSpace <= 0 || secondSpace <= firstSpace + 1 || secondSpace === line.byteLength - 1) {
    refuse("invalid_frame");
  }
  const methodBytes = line.subarray(0, firstSpace);
  if (!methodBytes.every(isAsciiMethodByte)) refuse("invalid_frame");
  const target = line.subarray(firstSpace + 1, secondSpace);
  const version = asciiText(line.subarray(secondSpace + 1));
  if (version !== "HTTP/1.1") refuse("invalid_frame");
  return { method: asciiText(methodBytes), target };
}

/** @param {number} byte */
function isAsciiMethodByte(byte) {
  return (byte >= 0x30 && byte <= 0x39)
    || (byte >= 0x41 && byte <= 0x5a)
    || (byte >= 0x61 && byte <= 0x7a);
}

/** @param {Uint8Array} bytes */
function asciiText(bytes) {
  let value = "";
  for (const byte of bytes) {
    if (byte > 0x7e || byte < 0x21) refuse("invalid_frame");
    value += String.fromCharCode(byte);
  }
  return value;
}

/** @param {Uint8Array} bytes */
function decodeTarget(bytes) {
  if (bytes.byteLength === 0) refuse("invalid_frame");
  let target = "";
  for (const byte of bytes) {
    if (byte < 0x21 || byte > 0x7e) refuse("route_not_found");
    target += String.fromCharCode(byte);
  }
  return target;
}

/** @param {Uint8Array} bytes @param {number} start @param {number} end */
function parseHeaders(bytes, start, end) {
  /** @type {Map<string, string[]>} */
  const headers = new Map();
  let offset = start;
  let count = 0;
  while (offset < end) {
    let lineEnd = findSequence(bytes, CRLF, offset, end);
    if (lineEnd < 0) lineEnd = end;
    const line = bytes.subarray(offset, lineEnd);
    if (line.byteLength === 0) refuse("invalid_header");
    count += 1;
    if (count > MAX_HEADER_COUNT) refuse("too_many_headers");

    const colon = line.indexOf(0x3a);
    if (colon <= 0) refuse("invalid_header");
    const nameBytes = line.subarray(0, colon);
    if (nameBytes.byteLength > MAX_HEADER_NAME_BYTES) refuse("invalid_header");
    for (const byte of nameBytes) {
      if (!isAsciiMethodByte(byte) && byte !== 0x2d) refuse("invalid_header");
    }

    const rawValue = line.subarray(colon + 1);
    const value = decodeHeaderValue(rawValue);
    const name = asciiLower(nameBytes);
    if (name === "forwarded" || name.startsWith("x-forwarded-")) refuse("forbidden_header");
    const values = headers.get(name) ?? [];
    values.push(value);
    headers.set(name, values);
    if (lineEnd === end) break;
    offset = lineEnd + CRLF.byteLength;
  }

  for (const name of ["authorization", "host", "origin", "x-csrf-token", "x-principal"]) {
    if ((headers.get(name)?.length ?? 0) > 1) refuse("duplicate_authority_header");
  }
  return headers;
}

/** @param {Uint8Array} bytes */
function decodeHeaderValue(bytes) {
  let start = 0;
  let end = bytes.byteLength;
  for (const byte of bytes) {
    if (byte < 0x20 || byte === 0x7f) refuse("invalid_header");
  }
  while (start < end && bytes[start] === 0x20) start += 1;
  while (end > start && bytes[end - 1] === 0x20) end -= 1;
  const valueBytes = bytes.subarray(start, end);
  try {
    const value = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(valueBytes);
    if (/\p{Cc}/u.test(value)) refuse("invalid_header");
    const trimmed = value.trim();
    if (byteLength(trimmed) > MAX_HEADER_VALUE_BYTES) refuse("invalid_header");
    return trimmed;
  } catch (error) {
    if (error instanceof PreparationRefusal) throw error;
    refuse("invalid_header");
  }
}

/** @param {Uint8Array} bytes */
function asciiLower(bytes) {
  let value = "";
  for (const byte of bytes) {
    const lower = byte >= 0x41 && byte <= 0x5a ? byte + 0x20 : byte;
    value += String.fromCharCode(lower);
  }
  return value;
}

/** @param {Map<string, string[]>} headers @param {string} name @param {boolean} required */
function singleHeader(headers, name, required) {
  const values = headers.get(name) ?? [];
  if (values.length > 1) refuse("duplicate_authority_header");
  if (values.length === 0) {
    if (required) {
      if (name === "authorization") refuse("invalid_bearer");
      if (name === "host") refuse("host_mismatch");
    }
    return null;
  }
  return values[0];
}

/** @param {string | null} authorization */
function validateBearer(authorization) {
  if (authorization === null) refuse("invalid_bearer");
  const separator = authorization.indexOf(" ");
  if (separator < 0 || authorization.slice(0, separator).toLowerCase() !== "bearer") {
    refuse("invalid_bearer");
  }
  const token = authorization.slice(separator + 1);
  if (token.length === 0 || byteLength(token) > MAX_TOKEN_BYTES) refuse("invalid_bearer");
  for (let index = 0; index < token.length; index += 1) {
    const code = token.charCodeAt(index);
    if (code <= 0x20 || code === 0x7f) refuse("invalid_bearer");
  }
}

/** @param {Map<string, string[]>} headers */
function hasForwardedAuthority(headers) {
  return headers.has("forwarded")
    || [...headers.keys()].some((name) => name.startsWith("x-forwarded-"));
}

/** @param {string} value */
function byteLength(value) {
  return new TextEncoder().encode(value).byteLength;
}

/** @param {string | undefined} value */
function parseContentLength(value) {
  if (value === undefined || !/^[0-9]+$/.test(value)) refuse("invalid_content_length");
  const length = Number(value);
  if (!Number.isSafeInteger(length)) refuse("body_too_large");
  return length;
}
