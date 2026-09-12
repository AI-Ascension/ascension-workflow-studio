// Read-only local CLI; same independent decoder as the browser worker, no HTTP listener.
import { open } from "node:fs/promises";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";

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
  const root = fileURLToPath(new URL("../", import.meta.url));
  // This CLI imports one decoder and has no dev-server role. Avoid loading the
  // repository Vite config, which would create a watch for vite.config.ts and
  // make an otherwise read-only compatibility check depend on global watcher
  // capacity. Keep the decoder's aliases explicit and equivalent.
  server = await createServer({
    root, configFile: false, logLevel: "silent", appType: "custom",
    plugins: [react()],
    resolve: { alias: {
      "@studio/contracts": fileURLToPath(new URL("../packages/contracts/src/index.ts", import.meta.url)),
      "@studio/document": fileURLToPath(new URL("../packages/document/src/index.ts", import.meta.url)),
      "@studio/client": fileURLToPath(new URL("../packages/client/src/index.ts", import.meta.url)),
    } },
    server: { middlewareMode: true, watch: null },
  });
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
