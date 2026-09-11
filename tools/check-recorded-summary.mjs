import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { deepStrictEqual } from "node:assert";
import { resolve } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
const run = promisify(execFile);
if (process.argv.length !== 4) throw new Error("Usage: node tools/check-recorded-summary.mjs PROTOCOL_WORKTREE BUNDLE");
const protocol = resolve(process.argv[2]), bundle = resolve(process.argv[3]);
const [owner, studio] = await Promise.all([
  run(process.execPath, [resolve(protocol, "tools/recorded-run/validate.mjs"), bundle], { maxBuffer: 4 * 1024 * 1024 }),
  run(process.execPath, [resolve("tools/inspect-recording.mjs"), bundle], { maxBuffer: 4 * 1024 * 1024 }),
]);
const expected = JSON.parse(owner.stdout), actual = JSON.parse(studio.stdout);
deepStrictEqual(actual, expected);
const artifact = createHash("sha256").update(await readFile(bundle)).digest("hex");
const schema = createHash("sha256").update(await readFile("contracts/recorded-run-candidate/schema.json")).digest("hex");
const record = { scope: "local independent Studio decoder versus protocol oracle on the identical artifact; source provenance is in the bundle", artifact_sha256: artifact, schema_sha256: schema, summary: actual, equal: true };
await mkdir("docs/evidence/recorded-run-local", { recursive: true });
await writeFile("docs/evidence/recorded-run-local/summary-comparison.json", JSON.stringify(record, null, 2) + "\n");
console.log(JSON.stringify({ equal: true, artifact_sha256: artifact, event_records: actual.event_records, accounting_records: actual.accounting_records }));
