// SPDX-License-Identifier: MIT
// @ts-check

import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_CONFIG_BYTES,
  MAX_JSON_BODY_BYTES,
  PreparationRefusal,
  parseBoundedJsonObject,
  validateBoundedJsonObject,
} from "../../tools/deploy/fixed-owner-preparation/bounded-json.mjs";
import { parsePreparationConfig } from "../../tools/deploy/fixed-owner-preparation/config.mjs";

/** @typedef {import("../../tools/deploy/fixed-owner-preparation/untrusted-envelope.js").PreparationRefusalCode} PreparationRefusalCode */
const encoder = new TextEncoder();

/** @param {unknown} value */
function bytes(value) {
  return encoder.encode(JSON.stringify(value));
}

/** @param {Uint8Array} source @param {number} reportedLength @returns {Uint8Array} */
function spoofedByteLength(source, reportedLength) {
  class SpoofedLengthBytes extends Uint8Array {}
  const view = new SpoofedLengthBytes(source.byteLength);
  Uint8Array.prototype.set.call(view, source);
  Object.defineProperty(view, "byteLength", { value: reportedLength });
  return view;
}

/** @param {() => unknown} action @param {PreparationRefusalCode} code */
function refuses(action, code) {
  assert.throws(action, /** @param {unknown} error */ (error) => (
    error instanceof PreparationRefusal && error.code === code
  ));
}

function validConfig() {
  return {
    schema_version: "studio.console-owner-preparation.v1",
    mode: "prepare_only",
    expected_host: "127.0.0.1:4185",
    expected_origin: "https://studio.example",
  };
}

test("config accepts only the closed prepare-only shape and freezes its copy", () => {
  const config = parsePreparationConfig(bytes(validConfig()));
  assert.equal(config.mode, "prepare_only");
  assert.equal(config.expected_host, "127.0.0.1:4185");
  assert.equal(config.expected_origin, "https://studio.example");
  assert.equal(Object.isFrozen(config), true);
  assert.deepEqual(Object.keys(config).sort(), [
    "expected_host", "expected_origin", "mode", "schema_version",
  ]);
});

test("config rejects duplicate decoded keys, including escaped-equivalent keys", () => {
  const duplicate = encoder.encode(
    '{"schema_version":"studio.console-owner-preparation.v1",'
    + '"mode":"prepare_only","\\u006dode":"prepare_only",'
    + '"expected_host":"console.example","expected_origin":null}',
  );
  refuses(() => parsePreparationConfig(duplicate), "duplicate_json_key");
});

test("config refuses unknown keys, missing keys, wrong schema and wrong mode", () => {
  refuses(() => parsePreparationConfig(bytes({ ...validConfig(), tls_verified: true })), "unknown_config_field");
  const { expected_origin: _origin, ...missingOrigin } = validConfig();
  refuses(() => parsePreparationConfig(bytes(missingOrigin)), "invalid_config");
  refuses(() => parsePreparationConfig(bytes({ ...validConfig(), schema_version: "v2" })), "invalid_config");
  refuses(() => parsePreparationConfig(bytes({ ...validConfig(), mode: "enabled" })), "invalid_config");
});

test("config refuses oversized, malformed, invalid UTF-8 and non-object JSON", () => {
  const oversized = new Uint8Array(MAX_CONFIG_BYTES + 1);
  oversized.fill(0x20);
  refuses(() => parsePreparationConfig(oversized), "config_too_large");
  refuses(() => parsePreparationConfig(Uint8Array.of(0xff)), "invalid_utf8");
  refuses(() => parsePreparationConfig(encoder.encode("{broken")), "invalid_json");
  refuses(() => parsePreparationConfig(encoder.encode("[]")), "json_root_required");
  refuses(() => parsePreparationConfig(encoder.encode("null")), "json_root_required");
});

test("config cap uses the actual view length when a subclass shadows byteLength", () => {
  const paddedValidConfig = new Uint8Array(MAX_CONFIG_BYTES + 1).fill(0x20);
  paddedValidConfig.set(bytes(validConfig()));
  const spoofed = spoofedByteLength(paddedValidConfig, 128);
  assert.equal(spoofed.byteLength, 128);
  refuses(() => parsePreparationConfig(spoofed), "config_too_large");
});

test("bounded JSON cap uses the actual view length when a subclass shadows byteLength", () => {
  const paddedValidJson = new Uint8Array(MAX_JSON_BODY_BYTES + 1).fill(0x20);
  paddedValidJson.set(encoder.encode("{}"));
  const spoofed = spoofedByteLength(paddedValidJson, 128);
  assert.equal(spoofed.byteLength, 128);
  refuses(() => validateBoundedJsonObject(spoofed), "json_too_large");
});

test("bounded JSON node budget uses the owned actual view length", () => {
  const values = Array.from({ length: 256 }, (_, index) => String(index)).join(",");
  const source = encoder.encode(`{"values":[${values}]}`);
  const spoofed = spoofedByteLength(source, 128);
  const parsed = parseBoundedJsonObject(spoofed);
  assert.deepEqual(parsed.values, Array.from({ length: 256 }, (_, index) => index));
});

test("config checks Host and Origin UTF-8 byte limits and Console lexical rules", () => {
  refuses(() => parsePreparationConfig(bytes({ ...validConfig(), expected_host: "é".repeat(129) })), "invalid_host");
  refuses(() => parsePreparationConfig(bytes({ ...validConfig(), expected_host: "console.example/path" })), "invalid_host");
  refuses(() => parsePreparationConfig(bytes({ ...validConfig(), expected_origin: "https://studio.example/path" })), "invalid_origin");
  refuses(() => parsePreparationConfig(bytes({ ...validConfig(), expected_origin: "https://" + "é".repeat(253) })), "invalid_origin");
  assert.equal(
    parsePreparationConfig(bytes({ ...validConfig(), expected_origin: null })).expected_origin,
    null,
  );
});
