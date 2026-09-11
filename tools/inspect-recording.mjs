// Read-only local CLI; same independent decoder as the browser worker, no HTTP listener.
import { open } from "node:fs/promises";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";

let server;
try {
  if (process.argv.length !== 3) throw new Error("usage");
  const file = await open(process.argv[2], "r");
  let bytes;
  try {
    const before = await file.stat();
    if (!before.isFile() || before.size > 16 * 1024 * 1024) throw new Error("resource_limit");
    bytes = new Uint8Array(before.size);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset);
      if (!bytesRead) throw new Error("source_changed");
      offset += bytesRead;
    }
    const after = await file.stat();
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error("source_changed");
  } finally { await file.close(); }
  server = await createServer({ root: fileURLToPath(new URL("../", import.meta.url)), logLevel: "silent", server: { middlewareMode: true, watch: null }, appType: "custom" });
  const { importRecording } = await server.ssrLoadModule("/packages/recording/src/import.ts");
  const result = await importRecording(bytes.buffer);
  const separator = result.bundleIdentity.indexOf(":");
  const { streams, ...completeness } = result.completeness;
  process.stdout.write(JSON.stringify({ valid: true, semantic_digest: result.digest,
    recording_identity: { namespace: result.bundleIdentity.slice(0, separator), value: result.bundleIdentity.slice(separator + 1) },
    evidence: result.evidence, completeness, streams,
    event_records: result.records.length, accounting_records: result.accounting.length,
    unsupported_records: [...result.records, ...result.accounting].filter(row => row.unsupported).length,
  }) + "\n");
} catch (error) {
  const code = error.code ?? error.message;
  process.stderr.write(JSON.stringify({ valid: false, code: /^[a-z][a-z0-9_]*$/.test(code) ? code : "inspection_failed" }) + "\n");
  process.exitCode = 1;
} finally { await server?.close(); }
