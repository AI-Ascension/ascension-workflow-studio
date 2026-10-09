// SPDX-License-Identifier: MIT
// @ts-check

import assert from "node:assert/strict";
import test from "node:test";
import { PreparationRefusal } from "../../tools/deploy/fixed-owner-preparation/bounded-json.mjs";
import { parsePreparationConfig } from "../../tools/deploy/fixed-owner-preparation/config.mjs";
import {
  MAX_BODY_BYTES,
  MAX_HEADER_BYTES,
  MAX_HEADER_COUNT,
  MAX_HEADER_VALUE_BYTES,
  parsePreparationEnvelope,
} from "../../tools/deploy/fixed-owner-preparation/envelope.mjs";

/** @typedef {import("../../tools/deploy/fixed-owner-preparation/untrusted-envelope.js").PreparationRefusalCode} PreparationRefusalCode */

const encoder = new TextEncoder();
const ROUTE = "/api/console-owner/v2/context-owner/invocations";

/** @param {string | null} [origin] */
function config(origin = "https://studio.example") {
  return parsePreparationConfig(encoder.encode(JSON.stringify({
    schema_version: "studio.console-owner-preparation.v1",
    mode: "prepare_only",
    expected_host: "console.example",
    expected_origin: origin,
  })));
}

/**
 * @param {{method?: string, target?: string, body?: string, bodyBytes?: Uint8Array, headers?: string[]}} [options]
 */
function frame({ method = "POST", target = ROUTE, body = "{}", bodyBytes, headers } = {}) {
  const payload = bodyBytes ?? encoder.encode(body);
  const fields = headers ?? [
    "Host: console.example",
    "Origin: https://studio.example",
    "Authorization: Bearer sample-private-token",
    `Content-Length: ${payload.byteLength}`,
  ];
  const head = encoder.encode(`${method} ${target} HTTP/1.1\r\n${fields.join("\r\n")}\r\n\r\n`);
  const request = new Uint8Array(head.byteLength + payload.byteLength);
  request.set(head);
  request.set(payload, head.byteLength);
  return request;
}

/** @param {string[]} extra @param {string} [origin] @param {string} [body] */
function headers(extra, origin = "https://studio.example", body = "{}") {
  const bodyBytes = encoder.encode(body);
  return [
    "Host: console.example",
    ...(origin === "<absent>" ? [] : [`Origin: ${origin}`]),
    "Authorization: Bearer sample-private-token",
    `Content-Length: ${bodyBytes.byteLength}`,
    ...extra,
  ];
}

/** @param {() => unknown} action @param {PreparationRefusalCode} [code] */
function refuses(action, code) {
  assert.throws(action, (error) => (
    error instanceof PreparationRefusal && (code === undefined || error.code === code)
  ));
}

test("Origin Option equality and Host matching follow the pinned Console contract", () => {
  const absentOrigin = frame({ headers: headers([], "<absent>") });
  assert.equal(parsePreparationEnvelope(absentOrigin, config(null)).origin, null);
  refuses(() => parsePreparationEnvelope(frame(), config(null)), "origin_mismatch");
  refuses(() => parsePreparationEnvelope(absentOrigin, config("https://studio.example")), "origin_mismatch");
  const changedOrigin = frame({ headers: headers([], "https://other.example") });
  refuses(() => parsePreparationEnvelope(changedOrigin, config()), "origin_mismatch");
  const wrongHost = frame({
    headers: [
      "Host: Console.example",
      "Origin: https://studio.example",
      "Authorization: Bearer sample-private-token",
      "Content-Length: 2",
    ],
  });
  refuses(() => parsePreparationEnvelope(wrongHost, config()), "host_mismatch");
});

test("authority duplicates, forwarded authority, principal claims and bad bearer refuse", () => {
  for (const name of ["Authorization", "Host", "Origin"]) {
    refuses(
      () => parsePreparationEnvelope(frame({ headers: headers([`${name}: duplicate`]) }), config()),
      "duplicate_authority_header",
    );
  }
  refuses(
    () => parsePreparationEnvelope(
      frame({ headers: headers(["X-CSRF-Token: first", "X-CSRF-Token: second"]) }),
      config(),
    ),
    "duplicate_authority_header",
  );
  refuses(
    () => parsePreparationEnvelope(frame({ headers: headers(["X-Principal: caller"])}), config()),
    "forbidden_principal_header",
  );
  refuses(
    () => parsePreparationEnvelope(frame({ headers: headers(["X-Forwarded-Origin: https://evil.example"])}), config()),
    "forbidden_header",
  );
  const noAuthorization = headers([]).filter((field) => !field.startsWith("Authorization:"));
  refuses(
    () => parsePreparationEnvelope(frame({ headers: noAuthorization }), config()),
    "invalid_bearer",
  );
  for (const authorization of ["Basic secret", "Bearer", "Bearer two words"]) {
    const fields = headers([]).map((field) => field.startsWith("Authorization:")
      ? `Authorization: ${authorization}`
      : field);
    refuses(() => parsePreparationEnvelope(frame({ headers: fields }), config()), "invalid_bearer");
  }
});

test("framing requires one decimal Content-Length, no Transfer-Encoding and exact bytes", () => {
  const valid = headers([]);
  const noLength = valid.filter((field) => !field.startsWith("Content-Length:"));
  refuses(() => parsePreparationEnvelope(frame({ headers: noLength }), config()), "invalid_content_length");
  refuses(
    () => parsePreparationEnvelope(frame({ headers: [...valid, "Content-Length: 2"] }), config()),
    "invalid_content_length",
  );
  refuses(
    () => parsePreparationEnvelope(frame({ headers: [...valid, "Transfer-Encoding: chunked"] }), config()),
    "transfer_encoding_forbidden",
  );
  for (const length of ["+2", "2x", ""]) {
    const fields = valid.map((field) => field.startsWith("Content-Length:")
      ? `Content-Length: ${length}`
      : field);
    refuses(() => parsePreparationEnvelope(frame({ headers: fields }), config()), "invalid_content_length");
  }
  const spacedLength = valid.map((field) => field.startsWith("Content-Length:")
    ? "Content-Length:  2 "
    : field);
  assert.equal(parsePreparationEnvelope(frame({ headers: spacedLength }), config()).trust, "untrusted");
  refuses(
    () => parsePreparationEnvelope(frame({ headers: valid, bodyBytes: encoder.encode("{} ") }), config()),
    "invalid_frame",
  );
  const truncated = frame();
  refuses(() => parsePreparationEnvelope(truncated.subarray(0, truncated.byteLength - 1), config()), "invalid_frame");
  refuses(
    () => parsePreparationEnvelope(frame({ body: "{}{}" }), config()),
    "invalid_json",
  );
});

test("header syntax, byte caps, count and bounded total frame refuse before output", () => {
  refuses(
    () => parsePreparationEnvelope(frame({ headers: headers(["Bad Name: value"]) }), config()),
    "invalid_header",
  );
  refuses(
    () => parsePreparationEnvelope(frame({ headers: headers([`X-Large: ${"x".repeat(MAX_HEADER_VALUE_BYTES + 1)}`]) }), config()),
    "invalid_header",
  );
  refuses(
    () => parsePreparationEnvelope(frame({ headers: headers([`X-UTF8: ${"é".repeat(1025)}`]) }), config()),
    "invalid_header",
  );
  const tooLongName = headers([`${"X".repeat(65)}: value`]);
  refuses(() => parsePreparationEnvelope(frame({ headers: tooLongName }), config()), "invalid_header");
  const tooLongHost = headers([]).map((field) => (
    field.startsWith("Host:") ? `Host: ${"x".repeat(257)}` : field
  ));
  refuses(() => parsePreparationEnvelope(frame({ headers: tooLongHost }), config()), "invalid_header");
  const tooLongOrigin = headers([]).map((field) => (
    field.startsWith("Origin:") ? `Origin: https://${"x".repeat(505)}` : field
  ));
  refuses(() => parsePreparationEnvelope(frame({ headers: tooLongOrigin }), config()), "invalid_header");
  refuses(
    () => parsePreparationEnvelope(frame({ headers: headers(["X-Bad: value\tbad"]) }), config()),
    "invalid_header",
  );
  const tooMany = headers(Array.from({ length: MAX_HEADER_COUNT }, (_, index) => `X-${index}: a`));
  refuses(() => parsePreparationEnvelope(frame({ headers: tooMany }), config()), "too_many_headers");

  const padded = headers(Array.from({ length: 4 }, () => `X-Pad: ${"x".repeat(2000)}`));
  refuses(() => parsePreparationEnvelope(frame({ headers: padded }), config()), "header_too_large");
  const incompleteHead = new Uint8Array(MAX_HEADER_BYTES + 1).fill(0x41);
  refuses(() => parsePreparationEnvelope(incompleteHead, config()), "header_too_large");
  refuses(
    () => parsePreparationEnvelope(new Uint8Array(MAX_HEADER_BYTES + MAX_BODY_BYTES + 1), config()),
    "frame_too_large",
  );
});

test("JSON body requires fatal UTF-8, valid object syntax, unique decoded keys and depth at most 32", () => {
  refuses(() => parsePreparationEnvelope(frame({ bodyBytes: Uint8Array.of(0xff) }), config()), "invalid_utf8");
  refuses(() => parsePreparationEnvelope(frame({ body: "{broken" }), config()), "invalid_json");
  refuses(() => parsePreparationEnvelope(frame({ body: "[]" }), config()), "json_root_required");
  refuses(
    () => parsePreparationEnvelope(frame({ body: '{"a":1,"\\u0061":2}' }), config()),
    "duplicate_json_key",
  );
  const depth32 = `{"x":${"[".repeat(30)}0${"]".repeat(30)}}`;
  const depth33 = `{"x":${"[".repeat(31)}0${"]".repeat(31)}}`;
  assert.equal(parsePreparationEnvelope(frame({ body: depth32 }), config()).trust, "untrusted");
  refuses(() => parsePreparationEnvelope(frame({ body: depth33 }), config()), "json_too_deep");
  const manyNodes = `{"v":[${Array.from({ length: 10000 }, () => "0").join(",")}]}`;
  assert.equal(parsePreparationEnvelope(frame({ body: manyNodes }), config()).trust, "untrusted");
});

test("oversized body refuses by byte count and output owns bytes without credentials", () => {
  const largeText = `{"x":"${"x".repeat(MAX_BODY_BYTES - 7)}"}`;
  const largeBody = encoder.encode(largeText);
  assert.equal(largeBody.byteLength, MAX_BODY_BYTES + 1);
  refuses(() => parsePreparationEnvelope(frame({ bodyBytes: largeBody }), config()), "body_too_large");

  const request = frame({
    body: '{"not_a_closed_dto":true}',
    headers: headers(
      ["X-CSRF-Token: csrf-value", "Cookie: session-cookie"],
      "https://studio.example",
      '{"not_a_closed_dto":true}',
    ),
  });
  const parsed = parsePreparationEnvelope(request, config());
  assert.equal(parsed.authority, "none");
  assert.equal(parsed.trust, "untrusted");
  assert.equal(parsed.credentialPresence.bearer, true);
  assert.equal(parsed.credentialPresence.csrf, true);
  assert.deepEqual(Object.keys(parsed).sort(), [
    "authority", "body", "credentialPresence", "host", "kind", "origin", "route", "trust",
  ]);
  const originalBody = request.subarray(request.byteLength - parsed.body.byteLength);
  assert.notEqual(parsed.body, originalBody);
  originalBody.fill(0);
  assert.equal(new TextDecoder().decode(parsed.body), '{"not_a_closed_dto":true}');
  assert.equal(JSON.stringify(parsed).includes("csrf-value"), false);
  assert.equal(JSON.stringify(parsed).includes("sample-private-token"), false);
  assert.equal(JSON.stringify(parsed).includes("session-cookie"), false);

  const malformed = frame({ headers: headers(["X-CSRF-Token: csrf-value"]) });
  try {
    parsePreparationEnvelope(malformed, config("https://different.example"));
    assert.fail("expected a refusal");
  } catch (error) {
    assert.ok(error instanceof PreparationRefusal);
    assert.equal(error.name, "PreparationRefusal");
    assert.equal(error.message, "origin_mismatch");
    assert.deepEqual(Object.keys(error), ["code"]);
    assert.equal(JSON.stringify(error), '{"code":"origin_mismatch"}');
    assert.equal(JSON.stringify(error).includes("csrf-value"), false);
    assert.equal(JSON.stringify(error).includes("sample-private-token"), false);
    assert.equal(error.message.includes("csrf-value"), false);
    assert.equal(error.message.includes("sample-private-token"), false);
    assert.equal(error.stack?.includes("csrf-value"), false);
    assert.equal(error.stack?.includes("sample-private-token"), false);
  }
});

test("parser snapshots shared request storage before exposing body bytes", () => {
  const expectedBody = '{"copied_from_shared_storage":true}';
  const request = frame({ body: expectedBody });
  const sharedBacking = new SharedArrayBuffer(request.byteLength);
  const sharedFrame = new Uint8Array(sharedBacking);
  Uint8Array.prototype.set.call(sharedFrame, request);

  const parsed = parsePreparationEnvelope(sharedFrame, config());
  assert.notEqual(parsed.body.buffer, sharedBacking);
  sharedFrame.fill(0);
  assert.equal(new TextDecoder().decode(parsed.body), expectedBody);
});

test("parser snapshots caller subclasses without invoking overridden methods", () => {
  class CallerControlledFrame extends Uint8Array {
    /** @returns {never} */
    subarray() {
      throw new Error("caller subarray must not run");
    }

    /** @returns {never} */
    [Symbol.iterator]() {
      throw new Error("caller iterator must not run");
    }
  }

  const expectedBody = '{"copied_from_subclass":true}';
  const request = frame({ body: expectedBody });
  const callerFrame = new CallerControlledFrame(request.byteLength);
  Uint8Array.prototype.set.call(callerFrame, request);

  const parsed = parsePreparationEnvelope(callerFrame, config());
  assert.notEqual(parsed.body.buffer, callerFrame.buffer);
  assert.equal(new TextDecoder().decode(parsed.body), expectedBody);
});
