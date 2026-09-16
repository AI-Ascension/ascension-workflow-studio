import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, mkdtemp, mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
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
