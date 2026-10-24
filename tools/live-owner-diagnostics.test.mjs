import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  DIAGNOSTIC_LOG_NAMES,
  diagnosticDestination,
  preserveDiagnosticLogs,
  preserveDiagnosticLogsSync,
} from "./live-owner-diagnostics.mjs";

// Simulate the fixture directory cleanup that used to destroy the evidence,
// and assert the diagnostics survive OUTSIDE it.
async function withIsolatedDiagnosticsRoot(run) {
  const workspace = await mkdtemp(join(tmpdir(), "studio-diagnostics-test-"));
  const diagnosticRoot = join(workspace, "diagnostics");
  const previous = process.env.STUDIO_LIVE_DIAGNOSTIC_ROOT;
  process.env.STUDIO_LIVE_DIAGNOSTIC_ROOT = diagnosticRoot;
  try {
    await run({ workspace, diagnosticRoot });
  } finally {
    if (previous === undefined) delete process.env.STUDIO_LIVE_DIAGNOSTIC_ROOT;
    else process.env.STUDIO_LIVE_DIAGNOSTIC_ROOT = previous;
    await rm(workspace, { recursive: true, force: true });
  }
}

function makeFixtureDir(workspace, files) {
  const targetDir = join(workspace, "studio-live-policy-production-abc123");
  return mkdir(targetDir, { recursive: true, mode: 0o700 }).then(async () => {
    for (const [name, contents] of Object.entries(files)) {
      await writeFile(join(targetDir, name), contents, { mode: 0o600 });
    }
    return targetDir;
  });
}

test("preserveDiagnosticLogs copies the named logs outside targetDir and they survive removal", async () => {
  await withIsolatedDiagnosticsRoot(async ({ workspace, diagnosticRoot }) => {
    const targetDir = await makeFixtureDir(workspace, {
      "gateway.log": "gateway diagnostics\n",
      "serve-workflow.log": "runtime diagnostics\n",
      "owned-child-pids.json": "[1234,5678]\n",
      "owned-children-report.json": "[]\n",
      // A file we must NOT copy: the fixture directory holds provider/context
      // keys and must never be carried wholesale.
      "provider-policy.sqlite3": "SECRET-KEY-MATERIAL",
    });

    const destination = await preserveDiagnosticLogs(targetDir);

    // Destination lives outside the fixture directory, under the configured root.
    assert.equal(destination, diagnosticDestination(targetDir));
    assert.equal(destination, join(diagnosticRoot, "studio-live-policy-production-abc123"));
    assert.ok(
      !destination.startsWith(targetDir + "/"),
      "preserved destination must not be inside the fixture directory",
    );

    // Reproduce the destructive cleanup that used to delete the evidence.
    await rm(targetDir, { recursive: true, force: true });
    await assert.rejects(stat(targetDir), { code: "ENOENT" });

    // All four named diagnostics survived and kept their bytes.
    assert.equal(await readFile(join(destination, "gateway.log"), "utf8"), "gateway diagnostics\n");
    assert.equal(await readFile(join(destination, "serve-workflow.log"), "utf8"), "runtime diagnostics\n");
    assert.equal(await readFile(join(destination, "owned-child-pids.json"), "utf8"), "[1234,5678]\n");
    assert.equal(await readFile(join(destination, "owned-children-report.json"), "utf8"), "[]\n");
    // And the secret-bearing store was NOT copied.
    await assert.rejects(stat(join(destination, "provider-policy.sqlite3")), { code: "ENOENT" });
  });
});

test("preserveDiagnosticLogs does not throw when a source file is missing", async () => {
  await withIsolatedDiagnosticsRoot(async ({ workspace }) => {
    // Only gateway.log exists; serve-workflow.log and owned-child-pids.json do not.
    const targetDir = await makeFixtureDir(workspace, { "gateway.log": "partial\n" });

    const destination = await preserveDiagnosticLogs(targetDir);
    assert.equal(await readFile(join(destination, "gateway.log"), "utf8"), "partial\n");
    await assert.rejects(stat(join(destination, "serve-workflow.log")), { code: "ENOENT" });
  });
});

test("preserveDiagnosticLogs does not throw when the fixture directory itself never existed", async () => {
  await withIsolatedDiagnosticsRoot(async ({ workspace }) => {
    const targetDir = join(workspace, "studio-live-policy-production-never-created");
    const destination = await preserveDiagnosticLogs(targetDir);
    assert.equal(destination, diagnosticDestination(targetDir));
    // The destination may exist but must contain nothing: no diagnostic was
    // fabricated for a fixture that never ran.
    const entries = await readdir(destination).catch(() => []);
    assert.deepEqual(entries, [], "no diagnostics should be produced for an absent fixture directory");
  });
});

test("preserveDiagnosticLogsSync mirrors the async behaviour for the exit path", async () => {
  await withIsolatedDiagnosticsRoot(async ({ workspace, diagnosticRoot }) => {
    const targetDir = await makeFixtureDir(workspace, { "gateway.log": "sync diagnostics\n" });
    const destination = preserveDiagnosticLogsSync(targetDir);
    assert.equal(destination, join(diagnosticRoot, "studio-live-policy-production-abc123"));
    await rm(targetDir, { recursive: true, force: true });
    assert.equal(await readFile(join(destination, "gateway.log"), "utf8"), "sync diagnostics\n");

    // Missing directory on the sync path is also safe.
    const absent = join(workspace, "studio-live-policy-production-absent");
    assert.equal(preserveDiagnosticLogsSync(absent), diagnosticDestination(absent));
  });
});

test("preserved diagnostic copies are not group- or world-readable", async () => {
  await withIsolatedDiagnosticsRoot(async ({ workspace, diagnosticRoot }) => {
    const targetDir = await makeFixtureDir(workspace, { "gateway.log": "secret-adjacent diagnostics\n" });
    const destination = await preserveDiagnosticLogs(targetDir);
    const stats = await stat(join(destination, "gateway.log"));
    // 0o600 => no group/other bits.
    assert.equal(stats.mode & 0o077, 0, `expected mode-0600 file, got ${(stats.mode & 0o777).toString(8)}`);
  });
});

test("preserved diagnostic copies are not group- or world-readable on the sync path either", async () => {
  await withIsolatedDiagnosticsRoot(async ({ workspace }) => {
    const targetDir = await makeFixtureDir(workspace, { "gateway.log": "exit-path diagnostics\n" });
    const destination = preserveDiagnosticLogsSync(targetDir);
    const stats = await stat(join(destination, "gateway.log"));
    assert.equal(stats.mode & 0o077, 0, `expected mode-0600 file on the sync path, got ${(stats.mode & 0o777).toString(8)}`);
  });
});

test("preserved diagnostic copies are not group- or world-readable on the async path", async () => {
  await withIsolatedDiagnosticsRoot(async ({ workspace }) => {
    const targetDir = await makeFixtureDir(workspace, { "gateway.log": "shutdown-path diagnostics\n" });
    const destination = await preserveDiagnosticLogs(targetDir);
    const stats = await stat(join(destination, "gateway.log"));
    assert.equal(stats.mode & 0o077, 0, `expected mode-0600 file on the async path, got ${(stats.mode & 0o777).toString(8)}`);
  });
});

test("the diagnostic destination directory is not group- or world-traversable", async () => {
  // Both forms create the destination, so both are asserted. mkdir's mode is
  // masked by umask, and this host runs under a restrictive umask (077), which
  // would make a 0755 destination *look* correct. Each case sets a permissive
  // umask so it tests the mode the code asks for rather than the one the
  // environment happens to allow.
  for (const [label, preserve] of [
    ["async", async (targetDir) => await preserveDiagnosticLogs(targetDir)],
    ["sync", (targetDir) => preserveDiagnosticLogsSync(targetDir)],
  ]) {
    await withIsolatedDiagnosticsRoot(async ({ workspace }) => {
      const targetDir = await makeFixtureDir(workspace, { "gateway.log": `directory mode ${label}\n` });
      const previousUmask = process.umask(0o000);
      try {
        const destination = await preserve(targetDir);
        const stats = await stat(destination);
        assert.equal(stats.mode & 0o077, 0, `expected mode-0700 directory on the ${label} path, got ${(stats.mode & 0o777).toString(8)}`);
      } finally {
        process.umask(previousUmask);
      }
    });
  }
});

test("DIAGNOSTIC_LOG_NAMES covers the evidence AC1 requires", () => {
  assert.deepEqual([...DIAGNOSTIC_LOG_NAMES].sort(), [
    "gateway.log",
    "owned-child-pids.json",
    "owned-children-report.json",
    "serve-workflow.log",
  ]);
});

// Follow the orderly cleanup through its shared helper and retain the separate
// synchronous exit-path gate. The source assertions protect actual call order,
// not an obsolete import on the stack script.
test("the live-owner stack preserves diagnostics before every fixture removal", async () => {
  const stackPath = resolve(dirname(fileURLToPath(import.meta.url)), "live-owner-production-stack.mjs");
  const fixturePath = resolve(dirname(fileURLToPath(import.meta.url)), "live-owner-stack-fixture.mjs");
  const stack = await readFile(stackPath, "utf8");
  const fixture = await readFile(fixturePath, "utf8");
  assert.match(stack, /import \{[^}]*removeFixtureDataAfterChildren[^}]*\} from "\.\/live-owner-stack-fixture\.mjs";/s);
  assert.match(stack, /preserveDiagnosticLogsSync,\s*\n\} from "\.\/live-owner-diagnostics\.mjs";/);

  const shutdownStart = stack.indexOf("function shutdown(");
  const emergencyStart = stack.indexOf("function emergencyCleanup(", shutdownStart);
  assert.ok(shutdownStart >= 0 && emergencyStart > shutdownStart, "both cleanup entry points must exist");
  const shutdown = stack.slice(shutdownStart, emergencyStart);
  assert.match(
    shutdown,
    /await removeFixtureDataAfterChildren\(targetDir,\s*\(\) => lifecycle\.stopChildren\(/,
    "orderly shutdown must route removal through the all-child settlement gate",
  );
  assert.match(shutdown, /if \(!removed\) \{ shutdownFailed = true;/);

  const removeStart = fixture.indexOf("export async function removeFixtureData(");
  const gateStart = fixture.indexOf("export async function removeFixtureDataAfterChildren(", removeStart);
  const fixtureStart = fixture.indexOf("export function createStackFixture(", gateStart);
  assert.ok(removeStart >= 0 && gateStart > removeStart && fixtureStart > gateStart);
  const removeBody = fixture.slice(removeStart, gateStart);
  const preserve = removeBody.indexOf("await preserveDiagnosticLogs(targetDir)");
  const remove = removeBody.indexOf("await rm(targetDir");
  assert.ok(preserve >= 0 && remove > preserve, "shared async removal must preserve named logs before rm");

  const gate = fixture.slice(gateStart, fixtureStart);
  assert.match(gate, /const outcome = await stopChildren\(\)/);
  assert.match(gate, /if \(!outcome\?\.settled \|\| !outcome\.ok\) return false/);
  assert.match(gate, /await removeFixtureData\(targetDir\);\s*return true/);

  const emergency = stack.slice(emergencyStart);
  const stop = emergency.indexOf("lifecycle.emergencyCleanupSync()");
  const emergencyGate = emergency.indexOf("if (!lifecycle.canRemoveFixtureData()) return");
  const syncPreserve = emergency.indexOf("preserveDiagnosticLogsSync(targetDir)");
  const syncRemove = emergency.indexOf("rmSync(targetDir");
  assert.ok(stop >= 0 && emergencyGate > stop, "emergency cleanup must stop owned children before checking settlement");
  assert.ok(syncPreserve > emergencyGate && syncRemove > syncPreserve, "emergency removal requires the settled gate and preserves first");
});
