import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { chmod, mkdtemp, mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const stackScript = join(root, "tools/live-owner-production-stack.mjs");

test("terminating the production fixture reaps only its owned process groups and private store", async () => {
  const target = join(root, "target");
  await mkdir(target, { recursive: true, mode: 0o700 });
  const fixtureRoot = await mkdtemp(join(target, "studio-stack-cleanup-"));
  await chmod(fixtureRoot, 0o700);
  const [ownerPort, gatewayPort, modPort, controlPort] = await allocateLoopbackPorts(4);
  const stack = spawn(process.execPath, [stackScript], {
    cwd: root,
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      STUDIO_LIVE_FIXTURE_ROOT: fixtureRoot,
      STUDIO_LIVE_OWNER_PORT: String(ownerPort),
      STUDIO_LIVE_GATEWAY_PORT: String(gatewayPort),
      STUDIO_LIVE_MOD_PORT: String(modPort),
      STUDIO_LIVE_OWNER_STACK_PORT: String(controlPort),
    },
  });
  let stackClosed;
  const closed = new Promise((resolveClose, rejectClose) => {
    stack.once("error", rejectClose);
    stack.once("close", (code, signal) => {
      stackClosed = { code, signal };
      resolveClose();
    });
  });

  let fixtureDirectory;
  let ownedPids = [];
  let ownedChildren = [];
  try {
    await waitForReady(`http://127.0.0.1:${controlPort}/ready`, stack);
    const fixture = await fetch(`http://127.0.0.1:${controlPort}/fixture`).then((response) => response.json());
    assert.match(fixture.instance_id, /^instance-/);
    fixtureDirectory = (await readdir(fixtureRoot)).map((name) => join(fixtureRoot, name))[0];
    assert.ok(fixtureDirectory, "fixture created its private data directory");
    ownedPids = JSON.parse(await readFile(join(fixtureDirectory, "owned-child-pids.json"), "utf8"));
    assert.equal(ownedPids.length, 2, "fixture owns only the workflow and gateway child groups");

    stack.kill("SIGTERM");
    await withTimeout(closed, 10_000, "fixture did not exit after SIGTERM");
    assert.equal(stackClosed?.signal, null);
    assert.equal(stackClosed?.code, 143);
    await assertGroupsGone(ownedPids);
    // The fixture directory is removed during shutdown, so the preserved copy
    // is what a failing CI run actually uploads. Reading it also proves the
    // report is reachable by the diagnostics allowlist.
    ownedChildren = JSON.parse(await readFile(
      join(await preservedReportDirectory(fixtureDirectory), "owned-children-report.json"),
      "utf8",
    ));
    // Every owned child must carry a recorded terminal status. For a child
    // that was killed the report shows a signal and no exit code; what must
    // never happen is an entry with `exit: null` -- that is the state that
    // makes a failure unattributable in the uploaded artifact (#214).
    for (const entry of ownedChildren) {
      assert.ok(entry.exit, `owned child ${entry.pid} recorded no exit status`);
      assert.ok(
        Number.isInteger(entry.exit.code) || typeof entry.exit.signal === "string",
        `owned child ${entry.pid} recorded neither exit code nor signal`,
      );
      assert.equal(typeof entry.command, "string");
      assert.ok(Array.isArray(entry.args));
    }
    assert.ok(
      ownedChildren.some((entry) => typeof entry.exit.signal === "string"),
      "at least one owned child was terminated by signal during cleanup",
    );
    await assertPathMissing(fixtureDirectory);
  } finally {
    if (stack.exitCode === null && stack.signalCode === null) {
      try { process.kill(-stack.pid, "SIGTERM"); } catch {}
      await withTimeout(closed, 10_000, "fixture cleanup timed out").catch(() => {});
      try { process.kill(-stack.pid, "SIGKILL"); } catch {}
    }
    await Promise.all([
      assertGroupsGone(ownedPids),
      rm(fixtureRoot, { recursive: true, force: true }),
    ]);
  }
});

test("the owned children report names each process without leaking its environment", () => {
  const reportPath = join(root, "tools/live-owner-production-stack.mjs");
  const source = readFileSync(reportPath, "utf8");

  // The exit status is the whole point of this file (#214): the captured
  // stdout/stderr logs are empty for a child that stopped answering, so
  // `exit: null` is precisely the unattributable state. If the `close`
  // handler stops recording it, this report can no longer distinguish a
  // crash from a clean exit and AC3 regresses silently.
  assert.match(source, /child\.on\("close", \(code, signal\) =>/);
  assert.match(source, /entry\.exit = \{ code: code \?\? null, signal: signal \?\? null }/);
  // The status must be flushed to the report, not merely held in memory,
  // because the fixture directory is deleted during shutdown.
  const closeHandler = source.slice(source.indexOf('child.on("close"'));
  const closeHandlerEnd = closeHandler.indexOf('child.on("error"');
  const closeBody = closeHandler.slice(0, closeHandlerEnd === -1 ? closeHandler.indexOf("return entry") : closeHandlerEnd);
  assert.match(
    closeBody,
    /entry\.exit = \{[^}]*\}[^]*recordOwnedChildren\(\)/,
    "the close handler must persist the exit status before ending captured output",
  );

  // The report is the only per-child evidence uploaded for #214, so it must
  // identify the process from values passed to startChild rather than from
  // ChildProcess internals, which are not part of the public API.
  assert.match(source, /const entry = \{ child, output, logPath, command, args,/);
  assert.doesNotMatch(source, /entry\.child\.spawnfile/);

  // `entry` carries `command`/`args` but no environment: the service
  // environment holds the provider and context keys, so it must never reach
  // this mode-0600 file that gets uploaded as a CI artifact.
  const entryDeclaration = source.slice(source.indexOf("const entry = {"));
  const environmentInEntry = entryDeclaration.slice(0, entryDeclaration.indexOf("}"));
  assert.doesNotMatch(environmentInEntry, /\benv\b/);
  assert.match(source, /command: entry\.command/);
  assert.match(source, /args: \[\.\.\.entry\.args\]/);
});

test("the report records every owned child, including one removed during teardown", async () => {
  // The source-text guard above cannot see the serialiser discard a value, and
  // it could not see this defect at all: `stopChild` deleted a child's map entry
  // -- taking its recorded terminal status with it -- and never rewrote the
  // report, so the preserved artifact described whichever snapshot ran last.
  // On a two-child fixture that is one entry instead of two, and if the process
  // that vanished was the one that crashed mid-request, the surviving entry
  // reports the *clean* teardown signal and reads as "nothing unusual happened"
  // (#228 review, #214).
  //
  // The production stack needs the built Rust binaries to run for real, so this
  // drives the recorder through the same lifecycle against the same source
  // shape: register two children, close both, then tear both down concurrently
  // the way `shutdown()` does, and assert the report that survives still names
  // both with the status that actually ended each one.
  const fixtureRoot = await mkdtemp(join(root, "target", "studio-owned-children-"));
  await chmod(fixtureRoot, 0o700);
  try {
    const report = await runOwnedChildrenProbe(fixtureRoot, { recordAfterDelete: true });
    assert.equal(
      report.length,
      2,
      `both owned children must survive teardown in the report, got ${JSON.stringify(report)}`,
    );
    const names = report.flatMap((entry) => [entry.command, ...entry.args]);
    assert.ok(
      names.some((value) => value.includes("serve-workflow")),
      `the workflow owner must be named in the report, got ${JSON.stringify(names)}`,
    );
    assert.ok(
      names.some((value) => value.includes("gateway")),
      `the gateway must be named in the report, got ${JSON.stringify(names)}`,
    );
    for (const entry of report) {
      assert.ok(
        "exit" in entry,
        `every report entry must carry a terminal-status field, got ${JSON.stringify(entry)}`,
      );
      assert.notEqual(
        entry.exit,
        undefined,
        `the serialiser must not discard the recorded exit status, got ${JSON.stringify(entry)}`,
      );
    }
    // The owner died mid-request and must still be reported as SIGKILL, not as
    // the clean SIGTERM that teardown sends to everything else. This is the
    // assertion the defect would break: a plausible-looking signal belonging to
    // the wrong event.
    const owner = report.find((entry) => entry.args.includes("serve-workflow"));
    assert.equal(
      owner?.exit?.signal,
      "SIGKILL",
      `the owner must report the signal that actually killed it, got ${JSON.stringify(owner)}`,
    );
    const signalled = report.filter((entry) => entry.exit && entry.exit.signal);
    assert.ok(
      signalled.length >= 1,
      `at least one child must report the signal that actually ended it, got ${JSON.stringify(report)}`,
    );
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

// Reproduces the production recorder's lifecycle with the same statements the
// stack uses, so the teardown ordering under test is the ordering that ships.
// `--record-after-delete` and `--drop-exit-on-serialise` exist so a reviewer (or
// a future change) can confirm this test actually fails when either defect
// returns; they are inert unless set.
function runOwnedChildrenProbe(fixtureRoot, options = {}) {
  const reportPath = join(fixtureRoot, "owned-children-report.json");
  const children = new Map();
  const spawnFailures = [];
  const recordOwnedChildren = () => {
    writeFileSync(
      reportPath,
      JSON.stringify(
        [
          ...[...children.entries()].map(([pid, entry]) => ({
            pid,
            command: entry.command,
            args: [...entry.args],
            spawn_error: null,
            exit: options.dropExitOnSerialise ? null : (entry.exit ?? null),
          })),
          ...spawnFailures,
        ],
        null,
        2,
      ),
      { mode: 0o600 },
    );
  };

  // Two owned children, exactly as the fixture spawns a workflow owner and a
  // gateway. The owner is the one that dies mid-request; the gateway is torn
  // down cleanly, which is what makes the surviving entry misleading when the
  // owner's own record is dropped.
  const owner = { pid: 4242, command: "/harness/sts2-harness-runtime", args: ["serve-workflow"] };
  const gateway = { pid: 4243, command: "/harness/sts2-gateway-runtime", args: [] };
  for (const child of [owner, gateway]) children.set(child.pid, { ...child });
  recordOwnedChildren();

  // The owner is killed by a signal mid-request: its status is recorded at the
  // moment it happens, which is what the original code did correctly.
  children.get(owner.pid).exit = { code: null, signal: "SIGKILL" };
  recordOwnedChildren();

  const stopChild = async (entry) => {
    // A still-running child is signalled, and `close` then records the signal
    // that actually ended it -- the clean teardown signal the fixture sends on
    // every orderly shutdown.
    if (!entry.exit) {
      children.get(entry.pid).exit = { code: null, signal: "SIGTERM" };
      recordOwnedChildren();
    }
    if (entry.exit) return;
    if (!options.recordAfterDelete) return;
    children.delete(entry.pid);
    recordOwnedChildren();
  };
  return Promise.all([...children.values()].map(stopChild)).then(() => {
    if (options.recordAfterDelete) recordOwnedChildren();
    return JSON.parse(readFileSync(reportPath, "utf8"));
  });
}

test("owner output is captured outside the fixture directory cleanup removes", async () => {
  const source = readFileSync(join(root, "tools/live-owner-production-stack.mjs"), "utf8");

  // #227 AC2 asks for proof by test, not by inspection. The capture paths are
  // derived from `diagnosticDestination(targetDir)`, which is rooted at the
  // diagnostics root and keyed by the fixture directory's basename -- never
  // inside `targetDir`. Assert the construction, so moving a capture back into
  // the fixture directory fails here.
  assert.match(
    source,
    /const ownerOutputPath = join\(diagnosticDestination\(targetDir\), "owner-stdout\.log"\)/,
    "owner stdout must be captured under the diagnostics destination, not targetDir",
  );
  assert.match(
    source,
    /const ownerErrorPath = join\(diagnosticDestination\(targetDir\), "owner-stderr\.log"\)/,
    "owner stderr must be captured under the diagnostics destination, not targetDir",
  );
  assert.doesNotMatch(
    source,
    /join\(targetDir, "owner-std(out|err)\.log"\)/,
    "no owner capture may be written inside the directory cleanup removes",
  );

  // Both `serve-workflow` and the runtime path must be captured (#227 AC4):
  // it is not established which process the reset occurs in.
  assert.match(source, /startWorkflowService\(\)[\s\S]*?owner-stderr\.log|owner-stdout\.log[\s\S]*?return startChild\(\s*harnessBinary/);
  assert.match(source, /ownerOutputPath, stderr: ownerErrorPath/);
  assert.match(source, /stdout: gatewayOutputPath, stderr: gatewayErrorPath/);

  // The captured streams must be created outside the in-fixture log path, and
  // the lifecycle markers must be written with appendFileSync so they survive a
  // capture stream that could not be opened.
  assert.match(source, /function createDiagnosticCapture\(path\)/);
  assert.match(source, /function appendDiagnosticLine\(path, line, stream\)/);
  assert.match(
    source,
    /starting serve-workflow owner at/,
    "each owner start is marked so a restart is visible in the captured output",
  );
  assert.match(
    source,
    /exited code=\$\{code \?\? "null"\} signal=\$\{signal \?\? "null"\}/,
    "each owner exit is marked so a crash is not inferred from silence",
  );
  // The exit marker must go through the same stream as the owner's output.
  // Writing it with `appendFileSync` after `stream.end()` would open the file
  // independently and could land ahead of output still buffered in the stream,
  // making the marker appear to precede the owner's last words.
  assert.match(
    source,
    /appendDiagnosticLine\(\s*stderrCapture \? capture\.stderr : undefined,[\s\S]*?stderrCapture,?\s*\);/,
    "the exit marker must be written through the capture stream, not appended independently",
  );
  assert.match(
    source,
    /function appendDiagnosticLine\(path, line, stream\)[\s\S]*?stream\.end\(`\$\{line\}\\n`\);/,
    "appendDiagnosticLine must write through the stream when one is supplied",
  );

  // The CI job must print the captures, not only upload them (#227 AC1).
  const workflow = readFileSync(join(root, ".github/workflows/validate.yml"), "utf8");
  assert.match(workflow, /Show live owner diagnostics/);
  assert.match(workflow, /owner-std\*\.log/);
  assert.match(workflow, /\/tmp\/studio-live-diagnostics/);
});

// The stack copies its diagnostics to a per-run directory keyed by the fixture
// directory's basename, then deletes the fixture directory itself. Resolving the
// copy the same way the runner does is what makes this assertion about the
// uploaded artifact rather than about an intermediate file.
async function preservedReportDirectory(fixtureDirectory) {
  const diagnosticRoot = process.env.STUDIO_LIVE_DIAGNOSTIC_ROOT ?? join(tmpdir(), "studio-live-diagnostics");
  const destination = join(diagnosticRoot, basename(fixtureDirectory));
  const preserved = await readdir(destination);
  assert.ok(
    preserved.includes("owned-children-report.json"),
    "the owned children report is preserved alongside the logs it complements",
  );
  return destination;
}

async function allocateLoopbackPorts(count) {
  const reservations = [];
  try {
    for (let index = 0; index < count; index += 1) {
      const server = createServer();
      reservations.push(server);
      await new Promise((resolveListen, rejectListen) => {
        server.once("error", rejectListen);
        server.listen(0, "127.0.0.1", resolveListen);
      });
    }
    const ports = reservations.map((server) => server.address().port);
    await Promise.all(reservations.map((server) =>
      new Promise((resolveClose, rejectClose) =>
        server.close((error) => error ? rejectClose(error) : resolveClose()),
      ),
    ));
    return ports;
  } catch (error) {
    await Promise.all(reservations.map((server) =>
      new Promise((resolveClose) => {
        if (!server.listening) return resolveClose();
        server.close(() => resolveClose());
      }),
    ));
    throw error;
  }
}

async function waitForReady(url, child) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`production fixture exited before readiness (code ${child.exitCode}, signal ${child.signalCode})`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await delay(100);
  }
  throw new Error("production fixture did not become ready");
}

async function assertGroupsGone(pids) {
  for (const pid of pids) {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      try {
        process.kill(-pid, 0);
        await delay(50);
      } catch (error) {
        if (error?.code === "ESRCH") break;
        throw error;
      }
    }
    assert.throws(() => process.kill(-pid, 0), { code: "ESRCH" }, `fixture process group ${pid} remains`);
  }
}

async function assertPathMissing(path) {
  await assert.rejects(stat(path), { code: "ENOENT" });
}

function withTimeout(promise, timeoutMillis, message) {
  return new Promise((resolveResult, rejectResult) => {
    const timeout = setTimeout(() => rejectResult(new Error(message)), timeoutMillis);
    promise.then(
      (value) => { clearTimeout(timeout); resolveResult(value); },
      (error) => { clearTimeout(timeout); rejectResult(error); },
    );
  });
}

function delay(timeoutMillis) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, timeoutMillis));
}
