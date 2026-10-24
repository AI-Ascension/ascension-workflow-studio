import { spawn } from "node:child_process";
import { appendFileSync, createWriteStream, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const safeLabel = (value) => typeof value === "string" && /^[a-z0-9_-]{1,32}$/i.test(value)
  ? value : "unknown";
const safeError = (error) => typeof error?.code === "string" && /^[A-Z0-9_]{1,40}$/.test(error.code)
  ? error.code : "IO_ERROR";
const STOP_GRACE_NS = 3_000_000_000n;
const STOP_BUDGET_NS = 4_000_000_000n;

function createDiagnosticCapture(path, createCaptureStream) {
  if (!path) return null;
  try {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const stream = createCaptureStream(path, { flags: "a", mode: 0o600 });
    const writer = { path, stream, errorCode: null, finishPromise: null, settled: false };
    stream.on("error", (error) => { writer.errorCode = safeError(error); });
    return writer;
  } catch {
    return { path, stream: null, errorCode: "OPEN_FAILED", finishPromise: null, settled: true };
  }
}

function pipeInto(source, writer) {
  if (!writer?.stream) {
    source.resume();
    return;
  }
  source.pipe(writer.stream, { end: false });
  writer.stream.on("error", () => {
    source.unpipe(writer.stream);
    source.resume();
  });
}

function finishWriter(writer) {
  if (!writer) return Promise.resolve({ settled: true, ok: true });
  if (writer.finishPromise) return writer.finishPromise;
  if (!writer.stream) {
    writer.settled = true;
    return Promise.resolve({ settled: true, ok: false, code: writer.errorCode ?? "OPEN_FAILED" });
  }
  writer.finishPromise = new Promise((resolveFinish) => {
    const stream = writer.stream;
    let finished = Boolean(stream.writableFinished);
    let closed = Boolean(stream.closed);
    const done = () => {
      if (!closed) return;
      writer.settled = true;
      const code = writer.errorCode ?? (finished ? null : "CLOSED_BEFORE_FINISH");
      resolveFinish({ settled: true, ok: finished && !code, code });
    };
    stream.once("finish", () => { finished = true; });
    stream.once("close", () => { closed = true; done(); });
    if (closed) return done();
    if (!stream.writableEnded && !stream.destroyed) {
      try { stream.end(); } catch (error) { writer.errorCode = safeError(error); }
    }
  });
  return writer.finishPromise;
}

function appendDiagnosticLine(path, event, writer, legacyLine) {
  if (!path) return;
  const lifecycleLine = `== studio-live fixture lifecycle ${JSON.stringify(event)} ==`;
  const prefix = event.event === "child_start" && legacyLine ? "" : "\n";
  const line = `${prefix}${[legacyLine, lifecycleLine].filter(Boolean).join("\n")}\n`;
  if (!writer?.stream || writer.errorCode || writer.stream.destroyed || writer.stream.writableEnded) {
    try { appendFileSync(path, line, { mode: 0o600 }); } catch {}
    return;
  }
  try {
    writer.stream.write(line);
  } catch {
    writer.errorCode = "WRITE_FAILED";
  }
}

export function createProcessLifecycle({
  cwd, ownedChildrenPath, ownedChildrenReportPath, createCaptureStream = createWriteStream,
}) {
  const children = new Map();
  const entries = new Set();
  const spawnFailures = [];
  const fixtureOriginAt = new Date().toISOString();
  const fixtureOriginNs = process.hrtime.bigint();
  let phase = "startup";
  let reason = "fixture_start";

  function stamp(entry, event, context = {}) {
    const now = process.hrtime.bigint();
    return {
      event,
      at: new Date().toISOString(),
      fixture_origin_at: fixtureOriginAt,
      elapsed_ms: Number(now - fixtureOriginNs) / 1_000_000,
      child_elapsed_ms: entry ? Number(now - entry.startedNs) / 1_000_000 : null,
      phase: safeLabel(context.phase ?? phase),
      reason: safeLabel(context.reason ?? reason),
    };
  }

  function recordOwnedChildren() {
    for (const entry of entries) if (entry.spawnFailureRecord) Object.assign(
      entry.spawnFailureRecord, { capture_status: entry.captureStatus, stop_unconfirmed: entry.stopUnconfirmed ?? null },
    );
    const records = [
      ...[...children.entries()].map(([pid, entry]) => ({
        pid,
        command: entry.command,
        args: [...entry.args],
        spawn_error: entry.spawnError,
        start: entry.start,
        stop_request: entry.stopRequest ?? null,
        stop_unconfirmed: entry.stopUnconfirmed ?? null,
        exit: entry.exit ?? null,
        capture_status: entry.captureStatus,
        capture_errors: [entry.outputWriter?.errorCode, entry.stdoutCapture?.errorCode,
          entry.stderrCapture?.errorCode, entry.captureFailureCode].filter(Boolean),
      })),
      ...spawnFailures,
    ];
    writeFileSync(ownedChildrenPath, JSON.stringify([...children.keys()]), { mode: 0o600 });
    writeFileSync(ownedChildrenReportPath, JSON.stringify(records, null, 2), { mode: 0o600 });
  }

  function setPhase(nextPhase, nextReason) {
    phase = safeLabel(nextPhase);
    reason = safeLabel(nextReason);
  }

  function startChild(command, args, env, logPath, capture) {
    const outputWriter = createDiagnosticCapture(logPath, createCaptureStream);
    const stdoutCapture = createDiagnosticCapture(capture?.stdout, createCaptureStream);
    const stderrCapture = createDiagnosticCapture(capture?.stderr, createCaptureStream);
    const child = spawn(command, args, {
      cwd, env, detached: true, stdio: ["ignore", "pipe", "pipe"],
    });
    const entry = {
      child, output: outputWriter?.stream, logPath, command, args: [...args], spawnError: null,
      outputWriter, stdoutCapture, stderrCapture, startedNs: process.hrtime.bigint(),
      start: null, stopRequest: null, stopUnconfirmed: null, exit: null, closed: false,
      captureStatus: "pending", captureFailureCode: null,
      captureFlushed: Promise.resolve({ settled: false, ok: false }),
    };
    if (Number.isInteger(child.pid)) children.set(child.pid, entry);
    entries.add(entry);
    let closeObserved;
    entry.closeObserved = new Promise((resolveClose) => { closeObserved = resolveClose; });
    entry.start = stamp(entry, "child_start");
    const ownerStart = args[0] === "serve-workflow"
      ? `== studio-live fixture: starting serve-workflow owner at ${entry.start.at} ==`
      : null;
    appendDiagnosticLine(capture?.stderr, { ...entry.start, pid: child.pid ?? null }, stderrCapture, ownerStart);
    pipeInto(child.stdout, outputWriter);
    pipeInto(child.stderr, outputWriter);
    pipeInto(child.stdout, stdoutCapture);
    pipeInto(child.stderr, stderrCapture);
    recordOwnedChildren();

    child.on("error", (error) => {
      entry.spawnError = safeError(error);
      if (!Number.isInteger(child.pid)) {
        const failure = {
          command, args: [...args], spawn_error: entry.spawnError, start: entry.start,
          spawn_error_event: stamp(entry, "spawn_error"), exit: null, capture_status: "pending", stop_unconfirmed: null,
        };
        entry.spawnFailureRecord = failure;
        spawnFailures.push(failure);
      }
      recordOwnedChildren();
    });
    child.on("exit", (code, signal) => {
      if (!Number.isInteger(child.pid)) return;
      entry.exit = { code: code ?? null, signal: signal ?? null, ...stamp(entry, "child_exit", entry.stopRequest ?? {}) };
      recordOwnedChildren();
    });
    child.on("close", (code, signal) => {
      if (Number.isInteger(child.pid)) {
        entry.exit ??= {
          code: code ?? null, signal: signal ?? null,
          ...stamp(entry, "child_exit", entry.stopRequest ?? {}),
        };
      }
      recordOwnedChildren();
      // `close` follows both stdio streams, so the terminal marker stays after their final bytes.
      if (entry.exit) {
        const legacyExit = `== studio-live fixture: child pid ${child.pid ?? "unknown"} exited code=${entry.exit.code ?? "null"} signal=${entry.exit.signal ?? "null"} ==`;
        appendDiagnosticLine(capture?.stderr, { ...entry.exit, pid: child.pid ?? null }, stderrCapture, legacyExit);
      }
      entry.captureFlushed = Promise.all([
        finishWriter(outputWriter), finishWriter(stdoutCapture), finishWriter(stderrCapture),
      ]).then((results) => {
        const settled = results.every((result) => result.settled);
        entry.captureFailureCode ??= results.find((result) => !result.ok)?.code ?? null;
        const ok = settled && results.every((result) => result.ok)
          && !entry.stopUnconfirmed && !entry.captureFailureCode;
        if (!entry.stopUnconfirmed) entry.captureStatus = ok ? "complete" : settled ? "failed" : "pending";
        try { recordOwnedChildren(); } catch (error) {
          entry.captureStatus = "failed";
          entry.captureFailureCode = safeError(error);
          return { settled, ok: false };
        }
        return { settled, ok };
      });
      entry.closed = true; entry.closedAtNs = process.hrtime.bigint();
      closeObserved();
    });
    return entry;
  }

  async function stopChild(entry, options = {}) {
    if (!entry?.child) return { settled: true, ok: true };
    if (entry.stopUnconfirmed) {
      const settled = entry.closed && [entry.outputWriter, entry.stdoutCapture, entry.stderrCapture]
        .every((writer) => !writer || writer.settled);
      return { settled, ok: false, code: entry.stopUnconfirmed.code };
    }
    const child = entry.child;
    const startedNs = process.hrtime.bigint();
    const deadlineNs = startedNs + STOP_BUDGET_NS;
    const graceDeadlineNs = startedNs + STOP_GRACE_NS;
    const stopContext = { phase: safeLabel(options.phase ?? phase), reason: safeLabel(options.reason ?? "fixture_shutdown") };
    const exited = childHasExited(child);
    if (Number.isInteger(child.pid) && !exited) {
      entry.stopRequest = stamp(entry, "child_stop_requested", stopContext);
      appendDiagnosticLine(entry.stderrCapture?.path, { ...entry.stopRequest, pid: child.pid ?? null }, entry.stderrCapture);
      signalOwnedGroup(child.pid, "SIGTERM");
    }
    if (Number.isInteger(child.pid)) {
      if (!exited) await waitUntil(entry.closeObserved, graceDeadlineNs);
      signalOwnedGroup(child.pid, "SIGKILL");
    } else {
      await waitUntil(entry.closeObserved, deadlineNs);
    }
    if (!entry.closed) await waitUntil(entry.closeObserved, deadlineNs);
    if (!entry.closed || entry.closedAtNs > deadlineNs) {
      markUnconfirmed(entry, "CHILD_CLOSE_TIMEOUT", stopContext);
    } else {
      const flushed = await waitUntil(entry.captureFlushed, deadlineNs);
      if (!flushed.settled || !flushed.value?.settled) markUnconfirmed(entry, "CAPTURE_FLUSH_TIMEOUT", stopContext);
      else if (!flushed.value.ok) markUnconfirmed(entry, entry.captureFailureCode ?? "CAPTURE_WRITE_FAILED", stopContext);
    }
    recordOwnedChildren();
    const settled = entry.closed && [entry.outputWriter, entry.stdoutCapture, entry.stderrCapture]
      .every((writer) => !writer || writer.settled);
    const ok = settled && entry.captureStatus === "complete" && !entry.stopUnconfirmed;
    if (!ok) cleanupFailed = true;
    return { settled, ok, code: ok ? null : entry.stopUnconfirmed?.code ?? entry.captureFailureCode };
  }

  let cleanupFailed = false;

  async function stopChildren(options) {
    const results = await Promise.all([...entries].map((entry) => stopChild(entry, options)));
    const settled = results.every((result) => result.settled);
    const ok = settled && results.every((result) => result.ok);
    return { settled, ok, results };
  }

  function markUnconfirmed(entry, code, context) {
    entry.captureFailureCode ??= code;
    entry.captureStatus = "unconfirmed";
    entry.stopUnconfirmed ??= { ...stamp(entry, "child_stop_unconfirmed", context), code };
    cleanupFailed = true;
  }

  function canRemoveFixtureData() {
    return !cleanupFailed && [...entries].every((entry) => entry.closed
      && entry.captureStatus === "complete"
      && [entry.outputWriter, entry.stdoutCapture, entry.stderrCapture].every((writer) => !writer || writer.settled));
  }

  function emergencyCleanupSync() {
    setPhase("cleanup", "emergency_exit");
    for (const entry of children.values()) {
      if (Number.isInteger(entry.child.pid) && entry.child.pid > 1) signalOwnedGroup(entry.child.pid, "SIGKILL");
    }
  }

  async function waitForCapture(entry, deadlineNs = process.hrtime.bigint() + STOP_BUDGET_NS) {
    const closed = await waitUntil(entry.closeObserved, deadlineNs);
    const flushed = closed.settled ? await waitUntil(entry.captureFlushed, deadlineNs) : { settled: false };
    if (!flushed.settled || !flushed.value?.ok) {
      const code = !closed.settled ? "CHILD_CLOSE_TIMEOUT"
        : !flushed.settled ? "CAPTURE_FLUSH_TIMEOUT" : entry.captureFailureCode ?? "CAPTURE_WRITE_FAILED";
      markUnconfirmed(entry, code, {});
      recordOwnedChildren();
      throw Object.assign(new Error("owned child capture did not settle successfully"), { code: entry.captureFailureCode });
    }
    return entry.exit;
  }

  function signalOwnedGroup(pid, signal) {
    // Signal only a PID retained in this fixture's owned-child map.
    if (!children.has(pid) || !Number.isInteger(pid) || pid <= 1) return;
    try { process.kill(-pid, signal); } catch {}
  }

  function waitUntil(promise, deadlineNs) {
    const remaining = deadlineNs - process.hrtime.bigint();
    if (remaining <= 0n) return Promise.resolve({ settled: false });
    let timer;
    const timeout = new Promise((resolveTimeout) => {
      timer = setTimeout(() => resolveTimeout({ settled: false }), Number((remaining + 999_999n) / 1_000_000n));
    });
    return Promise.race([
      Promise.resolve(promise).then((value) => ({ settled: process.hrtime.bigint() <= deadlineNs, value }), () => ({ settled: false, error: true })),
      timeout,
    ]).finally(() => clearTimeout(timer));
  }

  return {
    children, setPhase, startChild, stopChild, stopChildren, recordOwnedChildren, waitForCapture,
    emergencyCleanupSync, canRemoveFixtureData,
  };
}

export function childHasExited(child) {
  return child.exitCode !== null || child.signalCode !== null;
}
