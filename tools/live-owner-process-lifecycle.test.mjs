import assert from "node:assert/strict";
import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Writable } from "node:stream";
import test from "node:test";
import { diagnosticDestination } from "./live-owner-diagnostics.mjs";
import { createProcessLifecycle } from "./live-owner-process-lifecycle.mjs";
import { removeFixtureData, removeFixtureDataAfterChildren } from "./live-owner-stack-fixture.mjs";

async function createCaptureArea(createCaptureStream) {
  const workspace = await mkdtemp(join(tmpdir(), "studio-owner-lifecycle-"));
  const previousDiagnosticRoot = process.env.STUDIO_LIVE_DIAGNOSTIC_ROOT;
  const diagnosticRoot = join(workspace, "diagnostics");
  process.env.STUDIO_LIVE_DIAGNOSTIC_ROOT = diagnosticRoot;
  const fixtureRoot = join(workspace, "fixtures");
  await mkdir(fixtureRoot, { mode: 0o700 });
  const targetDir = await mkdtemp(join(fixtureRoot, "capture-case-"));
  const destination = diagnosticDestination(targetDir);
  const lifecycle = createProcessLifecycle({
    cwd: workspace,
    ownedChildrenPath: join(targetDir, "owned-child-pids.json"),
    ownedChildrenReportPath: join(targetDir, "owned-children-report.json"),
    createCaptureStream,
  });
  return {
    workspace, targetDir, destination, lifecycle,
    async cleanup() {
      for (const entry of lifecycle.children.values()) {
        if (!entry.closed) {
          await lifecycle.stopChild(entry, { phase: "final_cleanup", reason: "test_cleanup" });
        }
      }
      await rm(workspace, { recursive: true, force: true });
      if (previousDiagnosticRoot === undefined) delete process.env.STUDIO_LIVE_DIAGNOSTIC_ROOT;
      else process.env.STUDIO_LIVE_DIAGNOSTIC_ROOT = previousDiagnosticRoot;
    },
  };
}

function lifecycleMarkers(text) {
  return [...text.matchAll(/== studio-live fixture lifecycle (\{[^\n]+\}) ==/g)]
    .map((match) => JSON.parse(match[1]));
}

function withTestDeadline(promise, milliseconds) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("controlled cleanup exceeded its test bound")), milliseconds);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

test("the owned-child capture flushes exact terminal bytes outside removed fixture data", async () => {
  const area = await createCaptureArea();
  const { targetDir, destination, lifecycle } = area;
  const secret = "private-fixture-only-sentinel";
  const stdoutBytes = Buffer.from("controlled-stdout-final-bytes\n", "utf8");
  const stderrBytes = Buffer.from("controlled-stderr-final-bytes\n", "utf8");
  try {
    await writeFile(join(targetDir, "fixture.json"), secret, { mode: 0o600 });
    lifecycle.setPhase("in_window", "fixture_running");
    const script = `process.stdout.write(${JSON.stringify(stdoutBytes.toString())});`
      + `process.stderr.write(${JSON.stringify(stderrBytes.toString())});process.exitCode=23;`;
    const entry = lifecycle.startChild(
      process.execPath, ["-e", script], {}, join(targetDir, "serve-workflow.log"),
      { stdout: join(destination, "owner-stdout.log"), stderr: join(destination, "owner-stderr.log") },
    );
    const exit = await lifecycle.waitForCapture(entry);
    assert.equal(exit.code, 23, "the real child exit status is recorded");
    assert.equal(exit.signal, null);
    assert.equal(exit.phase, "in_window");
    assert.equal(exit.reason, "fixture_running");
    await removeFixtureData(targetDir);

    assert.deepEqual(await readFile(join(destination, "owner-stdout.log")), stdoutBytes);
    const stderrText = await readFile(join(destination, "owner-stderr.log"), "utf8");
    assert.ok(stderrText.includes(stderrBytes.toString()), "the child's final stderr bytes survive stream closure");
    const startLineEnd = stderrText.indexOf("\n", stderrText.indexOf("== studio-live fixture lifecycle "));
    const legacyExitStart = stderrText.indexOf("== studio-live fixture: child pid");
    assert.ok(startLineEnd >= 0 && legacyExitStart > startLineEnd);
    assert.deepEqual(Buffer.from(stderrText.slice(startLineEnd + 1, legacyExitStart - 1)), stderrBytes);
    const markers = lifecycleMarkers(stderrText);
    assert.deepEqual(markers.map(({ event }) => event), ["child_start", "child_exit"]);
    assert.ok(stderrText.indexOf("child_start") < stderrText.indexOf(stderrBytes.toString()));
    assert.ok(stderrText.indexOf(stderrBytes.toString()) < stderrText.indexOf("child_exit"));
    assert.match(markers[0].at, /^\d{4}-\d\d-\d\dT.*Z$/);
    assert.equal(markers[0].fixture_origin_at, markers[1].fixture_origin_at);
    assert.ok(Number.isFinite(markers[0].child_elapsed_ms));
    assert.ok(markers[1].child_elapsed_ms >= markers[0].child_elapsed_ms);
    assert.ok(Number.isFinite(markers[1].elapsed_ms));
    assert.ok(markers[1].elapsed_ms >= markers[0].elapsed_ms);

    const files = await readdir(destination);
    assert.ok(files.includes("owned-children-report.json"));
    assert.ok(!files.includes("fixture.json"), "cleanup copies only its diagnostic allowlist");
    const reportText = await readFile(join(destination, "owned-children-report.json"), "utf8");
    const [record] = JSON.parse(reportText);
    assert.equal(record.start.event, "child_start");
    assert.match(record.exit.at, /^\d{4}-\d\d-\d\dT.*Z$/);
    assert.equal(record.exit.code, 23);
    assert.equal(record.exit.event, "child_exit");
    assert.ok(Number.isFinite(record.exit.elapsed_ms));
    assert.ok(record.exit.elapsed_ms >= record.start.elapsed_ms);
    assert.equal(Object.hasOwn(record, "env"), false);
    assert.ok(!reportText.includes(secret));
    await assert.rejects(stat(targetDir), { code: "ENOENT" });
  } finally {
    await area.cleanup();
  }
});

test("owner restart events distinguish in-window child exit from final cleanup", async () => {
  const area = await createCaptureArea();
  const { targetDir, destination, lifecycle } = area;
  const stdoutPath = join(destination, "owner-stdout.log");
  const stderrPath = join(destination, "owner-stderr.log");
  try {
    lifecycle.setPhase("in_window", "owner_restart");
    const stoppingScript = [
      "const keep=setInterval(()=>{},1000);",
      "process.stdout.write('old-owner-ready\\n');",
      "process.on('SIGTERM',()=>{process.stderr.write('old-owner-stop-tail\\n');clearInterval(keep);});",
    ].join("");
    const oldOwner = lifecycle.startChild(
      process.execPath, ["-e", stoppingScript], {}, join(targetDir, "serve-workflow.log"),
      { stdout: stdoutPath, stderr: stderrPath },
    );
    await new Promise((resolveReady, rejectReady) => {
      const timer = setTimeout(() => rejectReady(new Error("controlled owner did not start")), 5_000);
      oldOwner.child.stdout.once("data", () => { clearTimeout(timer); resolveReady(); });
    });
    await lifecycle.stopChild(oldOwner, { phase: "in_window", reason: "owner_restart" });
    const oldExit = await lifecycle.waitForCapture(oldOwner);
    assert.equal(oldExit.phase, "in_window");
    assert.equal(oldExit.reason, "owner_restart");

    const replacementScript = "process.stdout.write('replacement-final-out\\n');"
      + "process.stderr.write('replacement-final-err\\n');";
    const replacement = lifecycle.startChild(
      process.execPath, ["-e", replacementScript], {}, join(targetDir, "serve-workflow.log"),
      { stdout: stdoutPath, stderr: stderrPath },
    );
    const replacementExit = await lifecycle.waitForCapture(replacement);
    assert.equal(replacementExit.code, 0);
    assert.equal(replacement.start.phase, "in_window");
    assert.equal(replacement.start.reason, "owner_restart");

    lifecycle.setPhase("in_window", "fixture_running");
    const cleanupScript = [
      "const keep=setInterval(()=>{},1000);",
      "process.stdout.write('cleanup-child-ready\\n');",
      "process.on('SIGTERM',()=>{process.stderr.write('cleanup-child-final-tail\\n');clearInterval(keep);});",
    ].join("");
    const cleanupChild = lifecycle.startChild(
      process.execPath, ["-e", cleanupScript], {}, join(targetDir, "serve-workflow.log"),
      { stdout: stdoutPath, stderr: stderrPath },
    );
    await new Promise((resolveReady, rejectReady) => {
      const timer = setTimeout(() => rejectReady(new Error("controlled cleanup child did not start")), 5_000);
      cleanupChild.child.stdout.once("data", () => { clearTimeout(timer); resolveReady(); });
    });
    await lifecycle.stopChild(cleanupChild, { phase: "final_cleanup", reason: "fixture_shutdown" });
    const cleanupExit = await lifecycle.waitForCapture(cleanupChild);
    assert.equal(cleanupExit.phase, "final_cleanup");
    assert.equal(cleanupExit.reason, "fixture_shutdown");
    await removeFixtureData(targetDir);

    const stdoutText = await readFile(stdoutPath, "utf8");
    const stderrText = await readFile(stderrPath, "utf8");
    assert.ok(stdoutText.includes("old-owner-ready\n"));
    assert.ok(stdoutText.includes("replacement-final-out\n"));
    assert.ok(stderrText.includes("old-owner-stop-tail\n"));
    assert.ok(stderrText.includes("replacement-final-err\n"));
    assert.ok(stderrText.includes("cleanup-child-final-tail\n"));
    const markers = lifecycleMarkers(stderrText);
    assert.deepEqual(markers.map(({ event }) => event), [
      "child_start", "child_stop_requested", "child_exit", "child_start", "child_exit",
      "child_start", "child_stop_requested", "child_exit",
    ]);
    assert.equal(markers[1].reason, "owner_restart");
    assert.equal(markers[2].reason, "owner_restart");
    assert.equal(markers[2].phase, "in_window");
    assert.equal(markers[3].reason, "owner_restart");
    assert.equal(markers[6].phase, "final_cleanup");
    assert.equal(markers[6].reason, "fixture_shutdown");
    assert.equal(stderrText.indexOf("old-owner-stop-tail") < stderrText.indexOf("child_exit"), true);
    assert.equal(stderrText.indexOf("child_exit") < stderrText.lastIndexOf("child_start"), true);
    const report = JSON.parse(await readFile(join(destination, "owned-children-report.json"), "utf8"));
    assert.equal(report.length, 3, "the report retains all owned children across restart and cleanup");
    assert.equal(report[0].exit.reason, "owner_restart");
    assert.equal(report[1].exit.reason, "owner_restart");
    assert.equal(report[2].exit.phase, "final_cleanup");
    assert.equal(report[2].exit.reason, "fixture_shutdown");
    assert.ok(report.every(({ exit }) => typeof exit.at === "string" && Number.isFinite(exit.elapsed_ms)));
    assert.ok(report.every(({ start, exit }) => start.fixture_origin_at === exit.fixture_origin_at
      && exit.elapsed_ms >= start.elapsed_ms && exit.child_elapsed_ms >= start.child_elapsed_ms));
    await assert.rejects(stat(targetDir), { code: "ENOENT" });
  } finally {
    await area.cleanup();
  }
});

test("controlled blocked capture keeps private fixture until its writer settles", async () => {
  let releaseFinal;
  const blocked = new Writable({
    write(_chunk, _encoding, done) { done(); },
    final(done) { releaseFinal = done; },
  });
  const area = await createCaptureArea((path, options) => path.endsWith("owner-stderr.log")
    ? blocked : createWriteStream(path, options));
  const { targetDir, destination, lifecycle } = area;
  let entry;
  try {
    await writeFile(join(targetDir, "private-sentinel"), "retain while capture is unsettled", { mode: 0o600 });
    entry = lifecycle.startChild(
      process.execPath, ["-e", "process.stderr.write('controlled final bytes\\n')"], {},
      join(targetDir, "serve-workflow.log"), {
        stdout: join(destination, "owner-stdout.log"), stderr: join(destination, "owner-stderr.log"),
      },
    );
    const startedNs = process.hrtime.bigint();
    const removal = removeFixtureDataAfterChildren(targetDir, () => lifecycle.stopChildren({
      phase: "final_cleanup", reason: "fixture_shutdown",
    }));
    const removed = await withTestDeadline(removal, 5_500);
    assert.ok(Number(process.hrtime.bigint() - startedNs) / 1_000_000 < 5_000);
    assert.equal(removed, false, "the production cleanup seam refuses removal after flush timeout");
    await stat(join(targetDir, "private-sentinel"));
    assert.equal(entry.captureStatus, "unconfirmed");
    assert.equal(entry.stopUnconfirmed?.code, "CAPTURE_FLUSH_TIMEOUT");
    const [record] = JSON.parse(await readFile(join(targetDir, "owned-children-report.json"), "utf8"));
    assert.equal(record.capture_status, "unconfirmed");
    assert.equal(record.stop_unconfirmed.code, "CAPTURE_FLUSH_TIMEOUT");
    assert.equal(lifecycle.canRemoveFixtureData(), false);
  } finally {
    releaseFinal?.();
    if (entry?.captureFlushed) await entry.captureFlushed;
    await area.cleanup();
  }
});
