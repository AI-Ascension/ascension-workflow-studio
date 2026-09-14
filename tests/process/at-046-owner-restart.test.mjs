// SPDX-License-Identifier: MIT
//
// AT-046 (P2-046): save an incomplete bounded draft, restart the owner
// store/service, and reload it through the owner ports.
//
// This is a real-process (`phase1_process`) check. It only talks to the
// authenticated owner over its HTTP management ports; it never reads the
// owner's SQLite file directly and never persists through localStorage. The
// owner process is started from an immutable pinned revision (see
// `contracts/live-owner-ci.lock.json`) and is restarted against the same store
// to prove that the semantic draft and its layout sidecar were persisted
// atomically.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

const OWNER_BIN = process.env.STS2_WORKFLOW_BIN;
const TOKEN = "studio-at046-ci-token";
const DRAFT_ID = "draft.at046";
const DEFINITION_ID = "at046.incomplete";

// An intentionally incomplete but bounded authoring document: it has no graph,
// so it could not be published, yet the owner accepts it as a draft.
const INCOMPLETE_DOCUMENT = {
  workflow_id: DEFINITION_ID,
  version: "0.1.0",
  annotations: { summary: "incomplete bounded draft" },
};

const SAVED_DOCUMENT = {
  workflow_id: DEFINITION_ID,
  version: "0.2.0",
  annotations: { summary: "still incomplete after restart" },
};

const SAVED_LAYOUT = {
  schemaVersion: "ascension.studio-layout/v1",
  semanticDigest: "0".repeat(64),
  positions: { main: { x: 99, y: 88 } },
};

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
    ["serve", "--listen", `127.0.0.1:${port}`, "--store", storePath, "--auth-profile", "studio-live"],
    {
      env: { ...process.env, STS2_WORKFLOW_TOKEN_STUDIO_LIVE: TOKEN },
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
  child.kill("SIGTERM");
  const timeout = new Promise((resolve) => setTimeout(() => resolve("timeout"), 10_000));
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
      if (response.ok) {
        const body = await response.json();
        if (body.status === "ok") return;
      }
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`owner did not report healthy on 127.0.0.1:${port}`);
}

async function ownerRequest(port, method, route, body) {
  const response = await fetch(`http://127.0.0.1:${port}${route}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const decoded = text === "" ? undefined : JSON.parse(text);
  return { status: response.status, body: decoded };
}

test("phase2_at_046: an incomplete bounded draft survives an owner restart through owner ports", async (t) => {
  if (!OWNER_BIN) {
    t.skip("set STS2_WORKFLOW_BIN to the pinned owner binary to run AT-046");
    return;
  }
  assert.ok(existsSync(OWNER_BIN), `owner binary not found at ${OWNER_BIN}`);

  const scratch = await mkdtemp(path.join(tmpdir(), "studio-at046-"));
  const storePath = path.join(scratch, "owner.sqlite");
  const port = await freePort();
  let child = startOwner(OWNER_BIN, port, storePath);

  try {
    await waitForHealth(port, child);

    // Create the incomplete bounded draft through the owner port.
    const created = await ownerRequest(port, "POST", "/v1/studio/drafts", {
      schema_version: "ascension.studio-authoring/v1",
      draft_id: DRAFT_ID,
      definition_id: DEFINITION_ID,
      document: INCOMPLETE_DOCUMENT,
      layout: { ...SAVED_LAYOUT, positions: { main: { x: 10, y: 20 } } },
      client_mutation_id: "at046.create.1",
    });
    assert.equal(created.status, 200, `create failed: ${JSON.stringify(created.body)}`);
    assert.equal(created.body.revision, 0);
    assert.equal(created.body.document.workflow_id, DEFINITION_ID);

    // Save a semantic (document) and layout change through the conditional-write API.
    const saved = await ownerRequest(port, "PUT", `/v1/studio/drafts/${DRAFT_ID}`, {
      schema_version: "ascension.studio-authoring/v1",
      expected_revision: created.body.revision,
      etag: created.body.etag,
      client_mutation_id: "at046.save.1",
      document: SAVED_DOCUMENT,
      layout: SAVED_LAYOUT,
    });
    assert.equal(saved.status, 200, `save failed: ${JSON.stringify(saved.body)}`);
    assert.equal(saved.body.revision, 1);

    // Restart the owner service against the same durable store.
    await stopOwner(child);
    child = startOwner(OWNER_BIN, port, storePath);
    await waitForHealth(port, child);

    // Reload through the owner port and prove the semantic draft and layout
    // were persisted together: the mutation etag covers both parts.
    const reloaded = await ownerRequest(port, "GET", `/v1/studio/drafts/${DRAFT_ID}`);
    assert.equal(reloaded.status, 200, `reload failed: ${JSON.stringify(reloaded.body)}`);
    assert.equal(reloaded.body.revision, saved.body.revision);
    assert.equal(reloaded.body.etag, saved.body.etag, "etag must be identical after restart");
    assert.deepEqual(reloaded.body.document, SAVED_DOCUMENT);
    assert.deepEqual(reloaded.body.layout, SAVED_LAYOUT);
    assert.equal(reloaded.body.definition_id, DEFINITION_ID);

    // The conditional-write state must also have survived: a save against the
    // pre-restart revision/etag advances exactly one revision.
    const afterRestart = await ownerRequest(port, "PUT", `/v1/studio/drafts/${DRAFT_ID}`, {
      schema_version: "ascension.studio-authoring/v1",
      expected_revision: reloaded.body.revision,
      etag: reloaded.body.etag,
      client_mutation_id: "at046.save.after-restart",
      document: SAVED_DOCUMENT,
      layout: { ...SAVED_LAYOUT, positions: { main: { x: 100, y: 100 } } },
    });
    assert.equal(afterRestart.status, 200, `post-restart save failed: ${JSON.stringify(afterRestart.body)}`);
    assert.equal(afterRestart.body.revision, reloaded.body.revision + 1);
  } catch (error) {
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}\n--- owner diagnostics ---\n${child.diagnostics}`,
    );
  } finally {
    await stopOwner(child);
    await rm(scratch, { recursive: true, force: true });
  }
});