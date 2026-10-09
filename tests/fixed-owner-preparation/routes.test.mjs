// SPDX-License-Identifier: MIT
// @ts-check

import assert from "node:assert/strict";
import test from "node:test";
import { PreparationRefusal } from "../../tools/deploy/fixed-owner-preparation/bounded-json.mjs";
import { parsePreparationConfig } from "../../tools/deploy/fixed-owner-preparation/config.mjs";
import { parsePreparationEnvelope } from "../../tools/deploy/fixed-owner-preparation/envelope.mjs";

/** @typedef {import("../../tools/deploy/fixed-owner-preparation/untrusted-envelope.js").PreparedRoute} PreparedRoute */

const encoder = new TextEncoder();
const config = parsePreparationConfig(encoder.encode(JSON.stringify({
  schema_version: "studio.console-owner-preparation.v1",
  mode: "prepare_only",
  expected_host: "console.example",
  expected_origin: "https://studio.example",
})));

/** @param {{method?: string, target?: string}} [options] */
function frame({ method = "POST", target = "/api/console-owner/v2/context-owner/invocations" } = {}) {
  const body = encoder.encode("{}");
  const headers = [
    "Host: console.example",
    "Origin: https://studio.example",
    "Authorization: Bearer sample-token",
    `Content-Length: ${body.byteLength}`,
  ];
  const head = encoder.encode(`${method} ${target} HTTP/1.1\r\n${headers.join("\r\n")}\r\n\r\n`);
  const request = new Uint8Array(head.byteLength + body.byteLength);
  request.set(head);
  request.set(body, head.byteLength);
  return request;
}

/** @param {() => unknown} action */
function refuses(action) {
  assert.throws(action, (error) => error instanceof PreparationRefusal);
}

test("all exact fixed routes resolve through the full production frame parser", () => {
  /** @type {Array<[string, PreparedRoute]>} */
  const cases = [
    ["/api/console-owner/v2/context-owner/invocations", "invoke"],
    ["/api/console-owner/v2/context-owner/invocations/receipt-lookup", "receipt_lookup"],
    ["/api/console-owner/v2/context-owner/invocations/cached-result", "cached_result"],
  ];
  for (const [target, expectedRoute] of cases) {
    const parsed = parsePreparationEnvelope(frame({ target }), config);
    assert.equal(parsed.route, expectedRoute);
    assert.equal(parsed.authority, "none");
    assert.equal(parsed.credentialPresence.csrf, false);
  }
});

test("route matching refuses wrong methods and every nonliteral target", () => {
  const allowed = "/api/console-owner/v2/context-owner/invocations";
  const cases = [
    { method: "GET", target: allowed },
    { target: `${allowed}?x=1` },
    { target: `${allowed}%2f` },
    { target: `${allowed}#fragment` },
    { target: `${allowed}\\child` },
    { target: "/api/console-owner/../v2/context-owner/invocations" },
    { target: "http://console.example/v2/context-owner/invocations" },
    { target: "//console.example/v2/context-owner/invocations" },
    { target: "/api/console-owner/v2/context-owner/invocations/" },
    { target: "/api/console-owner/v2/context-owner/invocations\u0000" },
    { target: `/api/console-owner/v2/context-owner/${"x".repeat(4100)}` },
  ];
  for (const entry of cases) refuses(() => parsePreparationEnvelope(frame(entry), config));
});

test("HTTP version and malformed request-line spacing are refused", () => {
  for (const line of [
    "POST /api/console-owner/v2/context-owner/invocations HTTP/1.0",
    "POST  /api/console-owner/v2/context-owner/invocations HTTP/1.1",
    "POST /api/console-owner/v2/context-owner/invocations HTTP/1.1 extra",
  ]) {
    const body = encoder.encode("{}");
    const headers = [
      "Host: console.example",
      "Origin: https://studio.example",
      "Authorization: Bearer token",
      `Content-Length: ${body.byteLength}`,
    ];
    const head = encoder.encode(`${line}\r\n${headers.join("\r\n")}\r\n\r\n`);
    const request = new Uint8Array(head.byteLength + body.byteLength);
    request.set(head);
    request.set(body, head.byteLength);
    refuses(() => parsePreparationEnvelope(request, config));
  }
});
