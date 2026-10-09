// SPDX-License-Identifier: MIT
// @ts-check

/** @typedef {import("./untrusted-envelope.js").PreparedConfig} PreparedConfig */

import {
  parseBoundedConfigObject,
  refuse,
} from "./bounded-json.mjs";

export const MAX_HOST_BYTES = 256;
export const MAX_ORIGIN_BYTES = 512;

const CONFIG_KEYS = Object.freeze([
  "schema_version",
  "mode",
  "expected_host",
  "expected_origin",
]);

/**
 * Reads the only supported local configuration. This function cannot enable
 * a process, bind a listener, prove a schema, or authenticate an owner.
 * @param {Uint8Array} bytes
 * @returns {PreparedConfig}
 */
export function parsePreparationConfig(bytes) {
  if (!(bytes instanceof Uint8Array)) refuse("invalid_input");
  return validatePreparationConfig(parseBoundedConfigObject(bytes));
}

/**
 * Rechecks shape at the parser boundary; valid caller-supplied config remains
 * configuration data, never proof or authority.
 * @param {unknown} value
 * @returns {PreparedConfig}
 */
export function validatePreparationConfig(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    refuse("invalid_config");
  }
  const record = /** @type {Record<string, unknown>} */ (value);
  const keys = Object.keys(record);
  if (keys.some((key) => !CONFIG_KEYS.includes(key))) refuse("unknown_config_field");
  if (keys.length !== CONFIG_KEYS.length || !CONFIG_KEYS.every((key) => Object.hasOwn(record, key))) {
    refuse("invalid_config");
  }
  if (
    record.schema_version !== "studio.console-owner-preparation.v1"
    || record.mode !== "prepare_only"
  ) {
    refuse("invalid_config");
  }

  const host = record.expected_host;
  if (typeof host !== "string" || !isValidHost(host)) refuse("invalid_host");
  const origin = record.expected_origin;
  if (origin !== null && (typeof origin !== "string" || !isValidOrigin(origin))) {
    refuse("invalid_origin");
  }

  /** @type {PreparedConfig} */
  const config = Object.freeze({
    schema_version: "studio.console-owner-preparation.v1",
    mode: "prepare_only",
    expected_host: host,
    expected_origin: origin,
  });
  return config;
}

/** @param {string} host */
function isValidHost(host) {
  const byteLength = new TextEncoder().encode(host).byteLength;
  return byteLength > 0
    && byteLength <= MAX_HOST_BYTES
    && !/[\s/\\%@?#]/u.test(host);
}

/** @param {string} origin */
function isValidOrigin(origin) {
  const byteLength = new TextEncoder().encode(origin).byteLength;
  if (
    byteLength === 0
    || byteLength > MAX_ORIGIN_BYTES
    || /[\s\\%@?#]/u.test(origin)
    || !(origin.startsWith("http://") || origin.startsWith("https://"))
  ) {
    return false;
  }
  const authority = origin.startsWith("http://")
    ? origin.slice("http://".length)
    : origin.slice("https://".length);
  return authority.length > 0 && !authority.includes("/");
}
