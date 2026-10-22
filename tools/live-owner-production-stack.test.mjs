import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { chmod, mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
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

test("stubbed production capture preserves exact bytes and separates in-window exits from cleanup", async () => {
  // Synthetic child executables exercise the real capture and cleanup code.
  // This test makes no claim about Harness, game, or provider behavior.
  const target = join(root, "target");
  await mkdir(target, { recursive: true, mode: 0o700 });
  const fixtureRoot = await mkdtemp(join(target, "studio-stack-report-"));
  const stubDirectory = await mkdtemp(join(target, "studio-stack-stubs-"));
  const diagnosticRoot = join(stubDirectory, "diagnostics");
  const harnessRoot = join(stubDirectory, "harness");
  // The idle gateway stub never queries the mod server. These parsed inputs
  // deliberately carry no owner contract claim and require no owner checkout.
  for (const path of [
    "runtime-v3-gameplay/golden/state-response.json",
    "runtime-v4-expert/golden/observation.json",
    "runtime-v4-expert-action/golden/action-settled.json",
  ]) {
    const destination = join(harnessRoot, "protocol-artifact", path);
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
    await writeFile(destination, '{"evidence":"synthetic-unqueried-capture-fixture"}\n', { mode: 0o600 });
  }
  const stubs = join(root, "tools/test-fixtures/live-owner-stubs");
  const [ownerPort, gatewayPort, modPort, controlPort] = await allocateLoopbackPorts(4);
  const stack = spawn(process.execPath, [stackScript], {
    cwd: root, detached: true, stdio: "ignore",
    env: {
      ...process.env,
      STUDIO_LIVE_FIXTURE_ROOT: fixtureRoot,
      STUDIO_LIVE_DIAGNOSTIC_ROOT: diagnosticRoot,
      STUDIO_LIVE_OWNER_PORT: String(ownerPort),
      STUDIO_LIVE_GATEWAY_PORT: String(gatewayPort),
      STUDIO_LIVE_MOD_PORT: String(modPort),
      STUDIO_LIVE_OWNER_STACK_PORT: String(controlPort),
      STUDIO_HARNESS_ROOT: harnessRoot,
      STUDIO_HARNESS_RUNTIME_BINARY: stubExecutable(stubs, stubDirectory, "owner-stub"),
      STUDIO_GATEWAY_BINARY: stubExecutable(stubs, stubDirectory, "gateway-stub"),
      STUDIO_MCP_BINARY: stubExecutable(stubs, stubDirectory, "mcp-stub"),
      STUDIO_PROVIDER_POLICY_FIXTURE_BINARY: stubExecutable(stubs, stubDirectory, "policy-fixture-stub"),
    },
  });
  const closed = new Promise((resolveClose, rejectClose) => {
    stack.once("error", rejectClose);
    stack.once("close", (code, signal) => resolveClose({ code, signal }));
  });
  let ownedPids = [];
  try {
    await waitForReady(`http://127.0.0.1:${controlPort}/ready`, stack);
    const fixtureDirectory = join(fixtureRoot, (await readdir(fixtureRoot))[0]);
    const report = () => readFile(join(fixtureDirectory, "owned-children-report.json"), "utf8").then(JSON.parse);
    let entries = await report();
    ownedPids = entries.map((entry) => entry.pid);
    assert.equal(entries.length, 2);
    const owners = (records) => records.filter((entry) => entry.command.endsWith("/owner-stub"));
    const secret = "SECRET-CAPTURE-REGRESSION";
    for (const name of ["provider-policy.sqlite3", "context-key.txt"]) {
      await writeFile(join(fixtureDirectory, name), secret, { mode: 0o600 });
    }
    const restart = async () => {
      const response = await fetch(`http://127.0.0.1:${controlPort}/restart`, { method: "POST" });
      assert.equal(response.status, 200);
      assert.equal((await response.json()).restarted, true);
      entries = await report();
      ownedPids = entries.map((entry) => entry.pid);
    };
    await restart();
    const second = owners(entries)[1];
    assert.equal(owners(entries)[0].exit.stop_reason, "restart");
    process.kill(second.pid, "SIGKILL");
    await waitForReport(report, (rows) => rows.some((entry) =>
      entry.pid === second.pid && entry.exit?.signal === "SIGKILL"));
    await restart();
    assert.equal(ownedPids.length, 4, "retain gateway and all three owner lifetimes");

    stack.kill("SIGTERM");
    assert.deepEqual(await withTimeout(closed, 15_000, "fixture did not exit"),
      { code: 143, signal: null });
    await assertGroupsGone(ownedPids);
    await assertPathMissing(fixtureDirectory);
    const destination = join(diagnosticRoot, basename(fixtureDirectory));
    assert.ok(!destination.startsWith(`${fixtureDirectory}/`));
    const preserved = JSON.parse(await readFile(join(destination, "owned-children-report.json"), "utf8"));
    assert.equal(preserved.length, ownedPids.length);
    const [restarted, crashed, cleanedUp] = owners(preserved);
    const gateway = preserved.find((entry) => entry.command.endsWith("/gateway-stub"));
    for (const entry of preserved) {
      assert.equal(entry.diagnostics_flushed, true);
      assert.ok(Number.isInteger(entry.exit.code) || typeof entry.exit.signal === "string");
      assert.equal(typeof entry.command, "string");
      assert.ok(Array.isArray(entry.args));
      assert.ok(!Object.hasOwn(entry, "env"));
      assert.ok(eventTime(entry.started_at) <= eventTime(entry.exit.observed_at));
      assert.ok(eventTime(entry.exit.observed_at) <= eventTime(entry.closed_at));
      assert.ok(eventTime(entry.started_at) <= eventTime(entry.cleanup_started_at));
    }
    assert.equal(restarted.exit.phase, "running");
    assert.equal(restarted.exit.stop_reason, "restart");
    assert.equal(restarted.stop_requested.reason, "restart");
    assert.ok(eventTime(restarted.stop_requested.at) <= eventTime(restarted.exit.observed_at));
    assert.ok(eventTime(restarted.closed_at) <= eventTime(crashed.started_at));
    assert.equal(crashed.exit.signal, "SIGKILL");
    assert.equal(crashed.exit.phase, "running");
    assert.equal(crashed.exit.stop_reason, null);
    assert.equal(crashed.stop_requested, null, "cleanup must not relabel an earlier crash");
    assert.ok(eventTime(crashed.closed_at) <= eventTime(cleanedUp.started_at));
    for (const entry of [cleanedUp, gateway]) {
      assert.equal(entry.exit.phase, "cleanup");
      assert.equal(entry.exit.stop_reason, "cleanup");
      assert.ok(eventTime(entry.cleanup_started_at) <= eventTime(entry.stop_requested.at));
      assert.ok(eventTime(entry.stop_requested.at) <= eventTime(entry.exit.observed_at));
    }

    // Large final writes exceed stream highWaterMarks. Compare exact bytes
    // after real fixture deletion; the abruptly killed owner has no tail.
    const ownerStart = `owner stub listening on ${ownerPort}\n`;
    const ownerTail = `owner stub final stdout:\r\n${"O".repeat(262_144)}\u2603\n`;
    const ownerError = "owner stub ready stderr\r\n";
    const ownerErrorTail = `owner stub final stderr:\r\n${"E".repeat(131_072)}\n`;
    assert.deepEqual(await readFile(join(destination, "owner-stdout.log")),
      Buffer.from(ownerStart + ownerTail + ownerStart + ownerStart + ownerTail));
    assert.deepEqual(await readFile(join(destination, "gateway-stdout.log")),
      Buffer.from(`gateway stub listening on ${gatewayPort}\ngateway stub final stdout:\r\n${"G".repeat(65_536)}\n`));
    const ownerStderr = await readFile(join(destination, "owner-stderr.log"), "utf8");
    const gatewayStderr = await readFile(join(destination, "gateway-stderr.log"), "utf8");
    const withoutMarkers = (value) => value.replace(/^== studio-live fixture: [^\n]* ==\n/gm, "");
    assert.deepEqual(Buffer.from(withoutMarkers(ownerStderr)),
      Buffer.from(ownerError + ownerErrorTail + ownerError + ownerError + ownerErrorTail));
    assert.deepEqual(Buffer.from(withoutMarkers(gatewayStderr)),
      Buffer.from(`gateway stub ready stderr\r\ngateway stub final stderr:\r\n${"D".repeat(65_536)}\n`));
    for (const entry of preserved) {
      const log = entry === gateway ? gatewayStderr : ownerStderr;
      assert.ok(log.includes(`child pid ${entry.pid} exited at ${entry.exit.observed_at}`));
      assert.ok(log.includes(`phase=${entry.exit.phase} stop_reason=${entry.exit.stop_reason ?? "none"}`));
    }
    assert.equal((ownerStderr.match(/starting serve-workflow owner at/g) ?? []).length, 3);
    assert.equal((gatewayStderr.match(/starting gateway at/g) ?? []).length, 1);
    assert.ok(ownerStderr.includes(`cleanup_started_at=${cleanedUp.cleanup_started_at}`));
    const files = await readdir(destination);
    assert.deepEqual(files.sort(), [
      "gateway-stderr.log", "gateway-stdout.log", "gateway.log",
      "owned-child-pids.json", "owned-children-report.json",
      "owner-stderr.log", "owner-stdout.log", "serve-workflow.log",
    ]);
    for (const name of files) {
      assert.ok(!(await readFile(join(destination, name))).includes(Buffer.from(secret)));
      assert.equal((await stat(join(destination, name))).mode & 0o077, 0);
    }
  } finally {
    if (stack.exitCode === null && stack.signalCode === null) {
      try { process.kill(-stack.pid, "SIGTERM"); } catch {}
      await withTimeout(closed, 10_000, "fixture cleanup timed out").catch(() => {});
      try { process.kill(-stack.pid, "SIGKILL"); } catch {}
    }
    await Promise.all([
      assertGroupsGone(ownedPids),
      rm(fixtureRoot, { recursive: true, force: true }),
      rm(stubDirectory, { recursive: true, force: true }),
    ]);
  }
});

function eventTime(value) {
  assert.equal(typeof value, "string", "lifecycle observation must carry a UTC timestamp");
  const milliseconds = Date.parse(value);
  assert.ok(Number.isFinite(milliseconds));
  assert.equal(new Date(milliseconds).toISOString(), value);
  return milliseconds;
}

async function waitForReport(read, predicate) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try { if (predicate(await read())) return; } catch {}
    await delay(10);
  }
  throw new Error("owned child lifecycle was not recorded");
}

// The fixture spawns its children with a sanitised PATH and execs the binary
// path directly, so each stub needs a real executable whose interpreter is
// absolute. Writing the wrapper into the fixture's own private directory keeps
// the repository tree free of generated executables.
function stubExecutable(stubs, stubDirectory, name) {
  const script = join(stubs, `${name}.mjs`);
  assert.ok(existsSync(script), `missing live-owner stub ${script}`);
  const executable = join(stubDirectory, name);
  writeFileSync(executable, `#!/bin/sh\nexec ${process.execPath} ${script} "$@"\n`, { mode: 0o700 });
  return executable;
}

test("the owned children report names each process without leaking its environment", () => {
  const reportPath = join(root, "tools/live-owner-production-stack.mjs");
  const source = readFileSync(reportPath, "utf8");

  // The exit status is the whole point of this file (#214): the captured
  // stdout/stderr logs are empty for a child that stopped answering, so
  // `exit: null` is precisely the unattributable state. If the `exit`
  // handler stops recording it, this report can no longer distinguish a
  // crash from a clean exit and AC3 regresses silently.
  assert.match(source, /child\.on\("exit", \(code, signal\) =>/);
  assert.match(source, /entry\.exit = \{\s*code: code \?\? null,\s*signal: signal \?\? null,/);
  // The status must be flushed to the report, not merely held in memory,
  // because the fixture directory is deleted during shutdown.
  const exitHandler = source.slice(source.indexOf('child.on("exit"'));
  const exitBody = exitHandler.slice(0, exitHandler.indexOf('child.on("close"'));
  assert.match(
    exitBody,
    /entry\.exit = \{[^}]*\}[^]*recordOwnedChildren\(\)/,
    "the exit handler must persist its observation independently of pipe closure",
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

test("teardown keeps every owned child in the report it preserves", () => {
  const source = readFileSync(join(root, "tools/live-owner-production-stack.mjs"), "utf8");

  // The fixture always spawns two children (gateway and owner), and
  // `recordOwnedChildren()` serialises whatever `children` holds at the instant
  // it is last called. `stopChild` used to `children.delete(child.pid)` after
  // teardown, so whichever child's `close` handler recorded `exit` last won and
  // the surviving report held ONE entry.
  //
  // This was not theoretical. Two CI artifacts from run 37185413888 each hold
  // exactly one entry for two spawned children, and in the #214 scenario the
  // owner's SIGKILL was overwritten in the artifact by the SIGTERM that routine
  // shutdown sent it afterwards -- evidence destroyed by the very teardown that
  // was meant to preserve it.
  assert.doesNotMatch(
    source,
    /children\.delete\(/,
    "teardown must not delete a child from the tracking map; its terminal status is the #214 evidence",
  );

  // Retaining entries must still leave a record on disk at the end of teardown,
  // otherwise the last `close` handler to fire wins again -- the original race,
  // one level down.
  // Bound the slice to the body of `stopChild` itself. An unbounded slice runs
  // to end-of-file and matches a `recordOwnedChildren()` call from some later
  // function, which makes this assertion pass for the wrong reason -- the same
  // class of defect this review exists to catch.
  //
  // The end is found by matching the body's braces rather than by measuring
  // its length. A character budget made this assertion a test of the
  // author's comment style: the real function left only 54 characters of
  // headroom, so the next honest explanatory comment would have failed a
  // guard whose subject is unrelated to prose length.
  const stopStart = source.indexOf("async function stopChild");
  assert.notEqual(stopStart, -1, "stopChild must exist");
  const stopBody = sliceFunctionBody(source, stopStart);
  // Strip line comments before asserting. A prose mention of the call inside
  // the function's own comment block would otherwise satisfy the assertion
  // while the code calls nothing -- which is exactly the failure mode this
  // review exists to catch, reproduced in the test that guards against it.
  const stopCode = stopBody
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");
  assert.match(
    stopCode,
    /recordOwnedChildren\(\)/,
    "teardown must re-record after each child so the last close handler cannot truncate the report",
  );

  // `spawn_error` is advertised in the report schema, but a spawn that fails is
  // never given a pid, so it never enters `children` -- the only collection the
  // serialiser reads. The field could therefore never carry a value. Failures
  // are tracked separately and folded in by the serialiser.
  assert.match(
    source,
    /const spawnFailures = \[\]/,
    "spawn failures have no pid, so they must be tracked outside the pid-keyed map",
  );
  assert.match(
    source,
    /\.\.\.spawnFailures/,
    "the serialiser must fold spawn failures into the report",
  );

  // Retained entries must not make teardown unbounded or repeat the signal work:
  // an already-exited child is detected and skipped, so a second `stopChild`
  // over the retained map is a no-op rather than a fresh wait.
  assert.match(source, /const exited = childHasExited\(child\);\s*\n\s*if \(!exited\)/);
});

test("CI prints and uploads the live owner captures", () => {
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

// Return `source` from `start` through the brace that closes the function
// declared there. Counting braces is enough for this file: `stopChild`
// contains no string or template literal with an unbalanced brace.
function sliceFunctionBody(source, start) {
  const open = source.indexOf("{", start);
  assert.notEqual(open, -1, "function body must open with a brace");
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    else if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error("function body is not closed");
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
