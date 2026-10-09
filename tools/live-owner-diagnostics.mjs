import { chmod, copyFile, mkdir } from "node:fs/promises";
import { chmodSync, copyFileSync, mkdirSync } from "node:fs";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";

// The gateway and runtime logs are the only evidence of what the pinned owner
// and gateway processes actually did before they were torn down, but they are
// written INSIDE the per-run fixture directory, which cleanup removes
// recursively. Copying them out here -- before any removal of the fixture
// directory -- is what keeps a failing live-owner run diagnosable
// (AI-Ascension/ascension-workflow-studio#214).
//
// The fixture directory is mode-0700 and holds provider/context keys, so this
// copies only the named diagnostic files, never the directory as a whole, and
// writes every copy mode-0600.
export const DIAGNOSTIC_LOG_NAMES = [
  "gateway.log",
  "serve-workflow.log",
  "owned-child-pids.json",
  "owned-children-report.json",
];

// Files the stack writes directly outside the fixture directory, so they need
// no preserving -- they are already in the uploaded directory by the time
// cleanup runs (#227). They are listed separately because
// `preserveDiagnosticLogs` copies files *out of* `targetDir` and these are not
// in it.
export const OWNER_CAPTURE_NAMES = [
  "owner-stdout.log",
  "owner-stderr.log",
  "gateway-stdout.log",
  "gateway-stderr.log",
];

export function diagnosticRoot() {
  return process.env.STUDIO_LIVE_DIAGNOSTIC_ROOT ?? join(tmpdir(), "studio-live-diagnostics");
}

// Returns the per-run destination directory. Reusing the fixture directory's
// basename keeps concurrent runs (the browser matrix runs one at a time per
// project, but retries and local reruns can overlap) from overwriting each
// other's diagnostics, without depending on fixture state that may not be
// initialized yet on the exit path.
export function diagnosticDestination(targetDir) {
  return join(diagnosticRoot(), basename(targetDir));
}

// Async form for the orderly shutdown path. A missing source file is not an
// error: the caller is already tearing down, and this must never throw, mask
// the real failure, or change the process exit code.
export async function preserveDiagnosticLogs(targetDir, names = DIAGNOSTIC_LOG_NAMES) {
  const destination = diagnosticDestination(targetDir);
  try {
    await mkdir(destination, { recursive: true, mode: 0o700 });
    // mkdir's mode does not tighten an existing directory; secure it before copying.
    await chmod(destination, 0o700);
    for (const name of names) {
      await copyDiagnosticFile(join(targetDir, name), join(destination, name));
    }
  } catch {
    // Diagnostics are best-effort; never fail cleanup over them.
  }
  return destination;
}

// Sync form for the process.on("exit") emergency path, where no async work is
// possible. Same best-effort contract: never throw.
export function preserveDiagnosticLogsSync(targetDir, names = DIAGNOSTIC_LOG_NAMES) {
  const destination = diagnosticDestination(targetDir);
  try {
    mkdirSync(destination, { recursive: true, mode: 0o700 });
    // mkdir's mode does not tighten an existing directory; secure it before copying.
    chmodSync(destination, 0o700);
    for (const name of names) {
      copyDiagnosticFileSync(join(targetDir, name), join(destination, name));
    }
  } catch {
    // Diagnostics are best-effort; never fail cleanup over them.
  }
  return destination;
}

async function copyDiagnosticFile(source, destination) {
  try {
    await copyFile(source, destination);
    await chmod(destination, 0o600);
  } catch {
    // Absent or unreadable source: nothing to preserve, and not an error.
  }
}

function copyDiagnosticFileSync(source, destination) {
  try {
    copyFileSync(source, destination);
    chmodSync(destination, 0o600);
  } catch {
    // Absent or unreadable source: nothing to preserve, and not an error.
  }
}
