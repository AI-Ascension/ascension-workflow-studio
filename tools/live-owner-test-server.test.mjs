import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const serverScript = resolve(root, "tools/live-owner-test-server.mjs");
const viteCli = resolve(root, "node_modules/vite/bin/vite.js");

test("the proxy records the transport error that caused an owner 502", {
  skip: process.platform !== "linux",
}, async () => {
  const [ownerPort, proxyPort, previewPort] = await allocateLoopbackPorts(3);
  const diagnosticDir = await mkdtemp(join(tmpdir(), "studio-live-proxy-log-"));
  const diagnosticLog = join(diagnosticDir, "studio-live-proxy.log");
  // Nothing listens on this port, so every owner route is refused at the socket
  // level. That is exactly the condition the live-owner production job reports
  // as `submission_refused_502`.
  const owner = createNetServer();
  await listen(owner, ownerPort);
  const ownerPortHolder = owner.address().port;
  await close(owner);
  const fixture = startProxyServer({
    ownerPort,
    proxyPort,
    previewPort,
    extraEnvironment: {
      STUDIO_LIVE_OWNER_PORT: String(ownerPortHolder),
      STUDIO_LIVE_PROXY_DIAGNOSTIC_DIR: diagnosticDir,
    },
  });

  try {
    await fixture.previewPid;
    fixture.child.send({ type: "start-proxy" });
    await waitForStatus(`http://127.0.0.1:${proxyPort}/`, fixture.child, 200);
    const refused = await fetch(`http://127.0.0.1:${proxyPort}/v1/workflow-runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(refused.status, 502);

    const entries = (await readFile(diagnosticLog, "utf8"))
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line));
    const ownerFailure = entries.find((entry) => (
      entry.role === "owner"
      && entry.path === "/v1/workflow-runs"
      && entry.outcome === "upstream_transport_error"
    ));
    assert.ok(
      ownerFailure,
      `the proxy must name the owner transport failure, got ${JSON.stringify(entries)}`,
    );
    assert.equal(ownerFailure.detail.code, "ECONNREFUSED");
    assert.equal(ownerFailure.method, "POST");
    assert.equal(ownerFailure.target_port, ownerPortHolder);
    assert.equal(typeof ownerFailure.at, "string");
    assert.equal(typeof ownerFailure.duration_ms, "number");
    assert.equal(
      entries.some((entry) => entry.role === "preview" && entry.path === "/v1/workflow-runs"),
      false,
      "an owner route must never be recorded against the preview target",
    );
  } finally {
    await stopOwnedServer(fixture.child);
    await rm(diagnosticDir, { recursive: true, force: true });
  }
});

test("the proxy records the owner status it forwarded for a served owner route", {
  skip: process.platform !== "linux",
}, async () => {
  const [ownerPort, proxyPort, previewPort] = await allocateLoopbackPorts(3);
  const diagnosticDir = await mkdtemp(join(tmpdir(), "studio-live-proxy-log-"));
  const diagnosticLog = join(diagnosticDir, "studio-live-proxy.log");
  const owner = createHttpServer((_request, response) => {
    response.writeHead(503, { "content-type": "application/json" });
    response.end(JSON.stringify({ error_code: "live_runtime_unavailable" }));
  });
  await listen(owner, ownerPort);
  const fixture = startProxyServer({
    ownerPort,
    proxyPort,
    previewPort,
    extraEnvironment: { STUDIO_LIVE_PROXY_DIAGNOSTIC_DIR: diagnosticDir },
  });

  try {
    await fixture.previewPid;
    fixture.child.send({ type: "start-proxy" });
    await waitForStatus(`http://127.0.0.1:${proxyPort}/`, fixture.child, 200);
    const refused = await fetch(`http://127.0.0.1:${proxyPort}/v1/health`);
    assert.equal(refused.status, 503);
    await refused.text();

    const entries = (await readFile(diagnosticLog, "utf8"))
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line));
    const ownerResponse = entries.find((entry) => (
      entry.role === "owner" && entry.path === "/v1/health"
    ));
    assert.ok(ownerResponse, `an answered owner route must be recorded, got ${JSON.stringify(entries)}`);
    assert.equal(ownerResponse.outcome, "upstream_response");
    assert.equal(ownerResponse.detail, "status=503");
  } finally {
    await stopOwnedServer(fixture.child);
    await close(owner);
    await rm(diagnosticDir, { recursive: true, force: true });
  }
});

test("SIGTERM closes the preview process group after the live-owner browser server stops", {
  skip: process.platform !== "linux",
}, async () => {
  const [ownerPort, proxyPort, previewPort] = await allocateLoopbackPorts(3);
  const owner = createHttpServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("owner-ok");
  });
  await listen(owner, ownerPort);
  const fixture = startProxyServer({ ownerPort, proxyPort, previewPort });
  let previewPid;
  let previewIdentityVerified = false;

  try {
    previewPid = await fixture.previewPid;
    assertPreviewIdentity(previewPid, fixture.child.pid, previewPort);
    previewIdentityVerified = true;
    fixture.child.send({ type: "start-proxy" });
    await waitForStatus(`http://127.0.0.1:${proxyPort}/`, fixture.child, 200);
    const ownerResponse = await fetch(`http://127.0.0.1:${proxyPort}/v1/health`);
    assert.equal(ownerResponse.status, 200);
    assert.equal(await ownerResponse.text(), "owner-ok");

    fixture.child.kill("SIGTERM");
    const exit = await waitForExit(fixture.child, 8_000);
    assert.deepEqual(exit, { code: 143, signal: null });
    await assertProcessGroupGone(previewPid);
    await assertPortClosed(previewPort);
  } finally {
    previewPid ??= await fixture.previewPid.catch(() => undefined);
    await stopOwnedServer(fixture.child);
    if (previewPid && previewIdentityVerified) await killOwnedPreview(previewPid);
    await close(owner);
  }
});

test("proxy startup failure also reaps its detached preview process group", {
  skip: process.platform !== "linux",
}, async () => {
  const [ownerPort, proxyPort, previewPort] = await allocateLoopbackPorts(3);
  const occupied = createNetServer();
  await listen(occupied, proxyPort);
  const fixture = startProxyServer({ ownerPort, proxyPort, previewPort });
  let previewPid;
  let previewIdentityVerified = false;

  try {
    previewPid = await fixture.previewPid;
    assertPreviewIdentity(previewPid, fixture.child.pid, previewPort);
    previewIdentityVerified = true;
    fixture.child.send({ type: "start-proxy" });
    const exit = await waitForExit(fixture.child, 8_000);
    assert.deepEqual(exit, { code: 1, signal: null });
    await assertProcessGroupGone(previewPid);
    await assertPortClosed(previewPort);
  } finally {
    previewPid ??= await fixture.previewPid.catch(() => undefined);
    await stopOwnedServer(fixture.child);
    if (previewPid && previewIdentityVerified) await killOwnedPreview(previewPid);
    await close(occupied);
  }
});

function startProxyServer({ ownerPort, proxyPort, previewPort, extraEnvironment }) {
  const child = spawn(process.execPath, [serverScript], {
    cwd: root,
    stdio: ["ignore", "ignore", "ignore", "ipc"],
    env: {
      ...process.env,
      STUDIO_LIVE_OWNER_PORT: String(ownerPort),
      STUDIO_LIVE_OWNER_PROXY_PORT: String(proxyPort),
      STUDIO_LIVE_OWNER_PREVIEW_PORT: String(previewPort),
      ...extraEnvironment,
    },
  });
  const previewPid = new Promise((resolvePid, rejectPid) => {
    child.on("message", (message) => {
      if (message?.type === "preview-process" && Number.isInteger(message.pid)) resolvePid(message.pid);
    });
    child.once("error", rejectPid);
    child.once("exit", (code, signal) => {
      rejectPid(new Error(`proxy server exited before reporting its preview (code ${code}, signal ${signal})`));
    });
  });
  return { child, previewPid };
}

async function allocateLoopbackPorts(count) {
  const reservations = [];
  try {
    for (let index = 0; index < count; index += 1) {
      const server = createNetServer();
      reservations.push(server);
      await new Promise((resolveListen, rejectListen) => {
        server.once("error", rejectListen);
        server.listen(0, "127.0.0.1", resolveListen);
      });
    }
    const ports = reservations.map((server) => server.address().port);
    await Promise.all(reservations.map(close));
    return ports;
  } catch (error) {
    await Promise.all(reservations.map(close));
    throw error;
  }
}

function listen(server, port) {
  return new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(port, "127.0.0.1", resolveListen);
  });
}

async function waitForStatus(url, child, expectedStatus) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`proxy server exited before readiness (code ${child.exitCode}, signal ${child.signalCode})`);
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      if (response.status === expectedStatus) return response;
      await response.body?.cancel();
    } catch {}
    await delay(100);
  }
  throw new Error("preview proxy did not become ready");
}

function assertPreviewIdentity(pid, ownerPid, port) {
  const output = execFileSync("ps", ["-p", String(pid), "-o", "pid=,ppid=,pgid=,args="], { encoding: "utf8" }).trim();
  const match = output.match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/);
  assert.ok(match, `fixture preview PID ${pid} is present`);
  assert.equal(Number(match[1]), pid);
  assert.equal(Number(match[2]), ownerPid, "preview is a child of the owned proxy server");
  assert.equal(Number(match[3]), pid, "detached preview process group is owned by its reported PID");
  assert.equal(
    match[4],
    `${process.execPath} ${viteCli} preview --host 127.0.0.1 --port ${port}`,
    "reported child is exactly this fixture's Vite preview command and port",
  );
}

async function waitForExit(child, timeoutMillis) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return { code: child.exitCode, signal: child.signalCode };
  }
  return new Promise((resolveExit, rejectTimeout) => {
    const timeout = setTimeout(() => rejectTimeout(new Error("proxy server did not exit")), timeoutMillis);
    child.once("close", (code, signal) => {
      clearTimeout(timeout);
      resolveExit({ code, signal });
    });
  });
}

async function assertProcessGroupGone(pid) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      process.kill(-pid, 0);
    } catch (error) {
      if (error?.code === "ESRCH") return;
      throw error;
    }
    await delay(50);
  }
  assert.fail(`owned preview process group ${pid} remains after proxy shutdown`);
}

async function assertPortClosed(port) {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    try {
      await fetch(`http://127.0.0.1:${port}`, { signal: AbortSignal.timeout(200) });
    } catch {
      return;
    }
    await delay(50);
  }
  assert.fail(`preview port ${port} remains open after proxy shutdown`);
}

async function stopOwnedServer(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await waitForExit(child, 8_000).catch(() => {
    if (Number.isInteger(child.pid) && child.pid > 1) {
      try { process.kill(child.pid, "SIGKILL"); } catch {}
    }
  });
}

async function killOwnedPreview(pid) {
  try { process.kill(-pid, "SIGTERM"); } catch {}
  try {
    await assertProcessGroupGone(pid);
  } catch {
    try { process.kill(-pid, "SIGKILL"); } catch {}
    await assertProcessGroupGone(pid);
  }
}

function close(server) {
  if (!server.listening) return Promise.resolve();
  server.closeAllConnections?.();
  return new Promise((resolveClose) => server.close(resolveClose));
}

function delay(timeoutMillis) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, timeoutMillis));
}
