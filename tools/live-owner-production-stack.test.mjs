import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
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
