// SPDX-License-Identifier: MIT
//
// Studio #109 AC5: negative authentication, Origin and CSRF conformance
// against the real pinned owner process.
//
// This is a real-process (`phase1_process`) check. It starts the exactly
// pinned owner binary from `contracts/live-owner-ci.lock.json` and speaks raw
// HTTP/1.1 to its loopback management port so that the request-line and header
// bytes are under test control. The browser journeys in `tests/browser` cannot
// cover this surface: the live-owner fixture proxy strips the browser `Origin`
// header before forwarding (see `tools/live-owner-test-server.mjs`), so no
// browser-driven request ever reaches the owner carrying an Origin.
//
// The owner implements the `origin_forbidden` guard in
// `crates/harness/src/management/http_parse.rs`. At the pinned revision the
// harness asserts that guard only once, against the unauthenticated
// `/v1/health` route (`crates/harness/tests/management.rs`). No test in the
// harness or Studio sends an `Origin` header to an authenticated route, and
// none covers a state-changing route, `Origin: null`, an empty `Origin`,
// mixed-case header spellings, or a cross-site-simple content type. These
// cases pin the observed behaviour there, including the limits that are NOT
// enforced, so an unsupported capability is never silently redefined as
// implemented.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

const OWNER_PIN = JSON.parse(
  await readFile(new URL("../../contracts/live-owner-ci.lock.json", import.meta.url), "utf8"),
);
const OWNER_BIN = process.env.STS2_WORKFLOW_BIN;
const TOKEN = "studio-109-negative-ci-token";
const PROFILE = "studio-negative";
const TOKEN_ENV = "STS2_WORKFLOW_TOKEN_STUDIO_NEGATIVE";
const DRAFT_ID = "draft.studio109.negative";
const DEFINITION_ID = "studio109.negative";
const CATALOG_ROUTE = "/v1/context-bindings";
const DRAFT_ROUTE = `/v1/studio/drafts/${DRAFT_ID}`;
const CREATE_ROUTE = "/v1/studio/drafts";

const BOUNDED_DOCUMENT = {
  workflow_id: DEFINITION_ID,
  version: "0.1.0",
  annotations: { summary: "studio109 negative-auth conformance" },
};

const BOUNDED_LAYOUT = {
  schemaVersion: "ascension.studio-layout/v1",
  semanticDigest: "0".repeat(64),
  positions: { main: { x: 1, y: 2 } },
};

// A syntactically complete create-draft body. Every rejection below must be
// attributable to the header/credential under test, never to a malformed body,
// so the same bytes are reused for the positive control.
const CREATE_BODY = JSON.stringify({
  schema_version: "ascension.studio-authoring/v1",
  draft_id: DRAFT_ID,
  definition_id: DEFINITION_ID,
  document: BOUNDED_DOCUMENT,
  layout: BOUNDED_LAYOUT,
  client_mutation_id: "mutation.studio109.negative.1",
});

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

function startOwner(binary, port, storePath) {
  const child = spawn(
    binary,
    ["serve", "--listen", `127.0.0.1:${port}`, "--store", storePath, "--auth-profile", PROFILE],
    {
      env: { ...process.env, [TOKEN_ENV]: TOKEN },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  child.diagnostics = "";
  child.stdout.on("data", (chunk) => (child.diagnostics += chunk));
  child.stderr.on("data", (chunk) => (child.diagnostics += chunk));
  return child;
}

async function stopOwner(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  const timeout = new Promise((resolve) => setTimeout(() => resolve("timeout"), 10_000));
  child.kill("SIGTERM");
  if ((await Promise.race([exited, timeout])) === "timeout") {
    child.kill("SIGKILL");
    await exited;
  }
}

async function waitForHealth(port, child) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`owner exited early with code ${child.exitCode}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/v1/health`, {
        headers: { Authorization: `Bearer ${TOKEN}` },
      });
      if (response.ok && (await response.json()).status === "ok") return;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`owner did not report healthy on 127.0.0.1:${port}: ${child.diagnostics}`);
}

/**
 * Sends raw HTTP/1.1 bytes so that header names, header order and a present
 * but empty `Origin` value all reach the owner exactly as written. `fetch`
 * normalises header names and refuses to emit an empty Origin, which would
 * make the case-insensitivity and empty-value cases untestable.
 */
function rawRequest(port, request) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, "127.0.0.1", () => socket.write(request));
    let received = "";
    socket.setEncoding("latin1");
    socket.on("data", (chunk) => {
      received += chunk;
    });
    const finish = () => {
      socket.destroy();
      const separator = received.indexOf("\r\n\r\n");
      const head = separator === -1 ? received : received.slice(0, separator);
      const rawBody = separator === -1 ? "" : received.slice(separator + 4);
      const statusMatch = head.match(/^HTTP\/1\.1 (\d{3})/);
      resolve({
        status: statusMatch ? Number(statusMatch[1]) : 0,
        head,
        rawBody,
        body: rawBody === "" ? undefined : JSON.parse(rawBody),
      });
    };
    socket.on("end", finish);
    socket.on("error", reject);
    socket.setTimeout(5_000, () => {
      socket.destroy();
      reject(new Error(`raw request timed out: ${request.split("\r\n")[0]}`));
    });
  });
}

function withBody(body) {
  return `Content-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`;
}

function get(route, headers = []) {
  return ["GET", route, headers];
}

function post(route, headers = []) {
  return ["POST", route, headers];
}

function buildRaw(port, [method, route, headers]) {
  return rawRequest(
    port,
    `${method} ${route} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\n${headers.join("\r\n")}${
      headers.length ? "\r\n" : ""
    }${withBody(method === "POST" ? CREATE_BODY : "")}`,
  );
}

const BEARER = `Authorization: Bearer ${TOKEN}`;
const JSON_TYPE = "Content-Type: application/json";

test("studio109_ac5: the pinned owner rejects unauthenticated and browser-origin management requests", async (t) => {
  if (!OWNER_BIN) {
    t.skip("set STS2_WORKFLOW_BIN to the pinned owner binary to run the Studio #109 negative-auth conformance");
    return;
  }
  assert.ok(existsSync(OWNER_BIN), `owner binary not found at ${OWNER_BIN}`);
  // Provenance: CI builds this binary from the pinned owner revision, exactly
  // like the AT-046 owner-restart check. `npm run test:owner-negative-auth`
  // locally requires the caller to supply a binary built from the same pin.
  assert.match(OWNER_PIN.revision, /^[0-9a-f]{40}$/, "the owner CI pin carries a full revision");
  t.diagnostic(`owner pin ${OWNER_PIN.repository}@${OWNER_PIN.revision}`);

  const scratch = await mkdtemp(path.join(tmpdir(), "studio109-negative-"));
  const storePath = path.join(scratch, "owner.sqlite");
  const port = await freePort();
  const child = startOwner(OWNER_BIN, port, storePath);

  const send = (request) => buildRaw(port, request);
  const draftExists = async () => (await send(get(DRAFT_ROUTE, [BEARER]))).status === 200;
  const readDraftEtag = async () => (await send(get(DRAFT_ROUTE, [BEARER]))).body?.etag;
  const ownerDiagnostics = async () => {
    // Let the piped stdio flush so a positive assertion is not a race.
    await new Promise((resolve) => setTimeout(resolve, 150));
    return child.diagnostics;
  };

  t.after(async () => {
    await stopOwner(child);
    await rm(scratch, { recursive: true, force: true });
  });

  try {
    await waitForHealth(port, child);

    // --- Positive controls: these establish that the negatives below are
    // --- attributable to the credential/header under test.
    const catalogOk = await send(get(CATALOG_ROUTE, [BEARER]));
    assert.equal(catalogOk.status, 200, "a valid bearer reaches the context owner catalog");
    assert.equal(catalogOk.body?.schema_version, "ascension.context-control.owner-catalog.v1");
    assert.equal(
      catalogOk.head.toLowerCase().includes("access-control-allow-origin"),
      false,
      "the owner publishes no CORS grant for the browser to rely on",
    );

    assert.equal(await draftExists(), false, "the draft is absent before the create attempt");
    const createOk = await send(post(CREATE_ROUTE, [BEARER, JSON_TYPE]));
    assert.equal(createOk.status, 200, "a valid bearer with no Origin creates the draft");
    assert.equal(await draftExists(), true, "the positive control created real durable state");
    const createdEtag = await readDraftEtag();
    assert.match(createdEtag ?? "", /^[a-f0-9]{64}$/, "the created draft exposes a revision etag");

    // --- AC5 negative auth: absent and invalid credentials fail closed.
    const noAuth = await send(get(CATALOG_ROUTE));
    assert.equal(noAuth.status, 401);
    assert.equal(noAuth.body?.error?.code, "authentication_required");

    const badAuth = await send(get(CATALOG_ROUTE, ["Authorization: Bearer studio-109-wrong-token"]));
    assert.equal(badAuth.status, 401);
    assert.equal(badAuth.body?.error?.code, "authentication_required");

    // --- AC5 negative Origin: a browser-origin request is refused before any
    // --- route logic, and the refusal is not a side-effecting no-op.
    const originCatalog = await send(get(CATALOG_ROUTE, [BEARER, "Origin: https://evil.test"]));
    assert.equal(originCatalog.status, 403);
    assert.equal(originCatalog.body?.error?.code, "origin_forbidden");

    // `Origin: null` is what a sandboxed iframe or a cross-origin redirect
    // sends; it must not be treated as an absent header.
    const nullOrigin = await send(get(CATALOG_ROUTE, [BEARER, "Origin: null"]));
    assert.equal(nullOrigin.status, 403, "a literal null Origin is refused");
    assert.equal(nullOrigin.body?.error?.code, "origin_forbidden");

    // Header names are case-insensitive on the wire, so an attacker must not be
    // able to smuggle the header past the guard by changing its case.
    for (const spelling of ["origin", "oRiGiN", "ORIGIN"]) {
      const mixed = await send(get(CATALOG_ROUTE, [BEARER, `${spelling}: https://evil.test`]));
      assert.equal(mixed.status, 403, `Origin spelling ${spelling} is refused`);
      assert.equal(mixed.body?.error?.code, "origin_forbidden");
    }

    // A present but empty Origin still names a browser origin and is refused.
    const emptyOrigin = await send(get(CATALOG_ROUTE, [BEARER, "Origin: "]));
    assert.equal(emptyOrigin.status, 403, "an empty Origin header is refused rather than ignored");
    assert.equal(emptyOrigin.body?.error?.code, "origin_forbidden");

    // The guard runs before authentication, so it never becomes an oracle for
    // which tokens are valid.
    const originNoAuth = await send(get(CATALOG_ROUTE, ["Origin: https://evil.test"]));
    assert.equal(originNoAuth.status, 403, "Origin is refused before credential evaluation");
    assert.equal(originNoAuth.body?.error?.code, "origin_forbidden");

    // --- AC5 negative CSRF: the state-changing route must not accept an
    // --- Origin-bearing request, and must leave no durable trace.
    const originCreate = await send(post(CREATE_ROUTE, [BEARER, JSON_TYPE, "Origin: https://evil.test"]));
    assert.equal(originCreate.status, 403);
    assert.equal(originCreate.body?.error?.code, "origin_forbidden");
    // Same identity and revision as before: the refused request mutated nothing.
    assert.equal(await readDraftEtag(), createdEtag, "an Origin-refused create writes no new revision");

    // A cross-site "simple request" uses a non-JSON content type so that no
    // preflight is required. The owner refuses those before parsing the body.
    for (const contentType of [
      "Content-Type: text/plain",
      "Content-Type: application/x-www-form-urlencoded",
    ]) {
      const simple = await send(post(CREATE_ROUTE, [BEARER, contentType]));
      assert.equal(simple.status, 400, `${contentType} is refused on a state-changing route`);
      assert.equal(simple.body?.error?.code, "content_type_required");
    }

    // A charset parameter must not make a cross-site-simple request acceptable.
    const charset = await send(post(CREATE_ROUTE, [BEARER, "Content-Type: application/json; charset=utf-8"]));
    assert.equal(charset.status, 400, "the owner requires the exact application/json media type");

    // There is no CORS preflight: a browser cannot negotiate cross-origin
    // access to these routes even before the Origin guard applies.
    const preflight = await rawRequest(
      port,
      `OPTIONS ${CATALOG_ROUTE} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nOrigin: https://evil.test\r\nAccess-Control-Request-Method: GET\r\nConnection: close\r\n\r\n`,
    );
    assert.equal(preflight.status, 400, "no CORS preflight is served");
    assert.equal(preflight.body?.error?.code, "method_not_allowed");

    // --- Documented limitation, recorded rather than redefined: the guard keys
    // --- on the Origin header only. `Sec-Fetch-Site` is not consulted, so a
    // --- non-browser client that simply omits Origin is indistinguishable from
    // --- the same-origin adapter. Loopback binding plus the bearer credential,
    // --- not `Sec-Fetch-*`, are what restrict this surface today.
    // --- This assertion records the pinned revision's behaviour. The CI job
    // --- checks out the harness at `contracts/live-owner-ci.lock.json`, so
    // --- hardening a newer owner cannot break this job until the pin is
    // --- deliberately advanced; update this case with that bump.
    const fetchMetadata = await send(get(CATALOG_ROUTE, [BEARER, "Sec-Fetch-Site: cross-site"]));
    assert.equal(
      fetchMetadata.status,
      200,
      "Sec-Fetch-Site alone is not a gate; the guard is the Origin header",
    );

    // --- No credential or private content may appear in responses or logs.
    assert.equal(
      catalogOk.head.includes(TOKEN) || catalogOk.rawBody.includes(TOKEN),
      false,
      "the owner never echoes the bearer credential",
    );
    const createHead = createOk.head + createOk.rawBody;
    assert.equal(createHead.includes(TOKEN), false, "a successful create does not echo the credential");
    assert.equal(
      /policy_bytes|credential_realm_ref|private_key/i.test(catalogOk.rawBody),
      false,
      "the owner catalog discloses no policy bytes or credential material",
    );

    await stopOwner(child);
    const log = await ownerDiagnostics();
    assert.equal(log.includes(TOKEN), false, "the owner log never contains the bearer credential");
    assert.equal(
      log.includes(JSON.stringify(BOUNDED_DOCUMENT)),
      false,
      "the owner log does not echo the submitted draft document",
    );
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const log = await ownerDiagnostics();
      assert.equal(log.includes(TOKEN), false, "the owner log never contains the bearer credential");
    }
  }
});
