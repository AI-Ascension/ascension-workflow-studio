// Snapshot protocol-owned candidate bytes and synthetic fixtures; never writes to source.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
const source = resolve(process.argv[2]);
const destination = new URL("../contracts/recorded-run-candidate/", import.meta.url);
await mkdir(destination, { recursive: true });
const checksums = {};
const inventory = await readFile(resolve(source, "artifacts/recorded-run-bundle-v1/SHA256SUMS"));
for (const line of inventory.toString("utf8").trim().split("\n")) {
  const match = /^([a-f0-9]{64})  ([a-zA-Z0-9_.\/-]+)$/.exec(line);
  if (!match || match[2].split("/").includes("..") || match[2].startsWith("/")) throw new Error("Unsafe artifact inventory");
  const bytes = await readFile(resolve(source, "artifacts/recorded-run-bundle-v1", match[2]));
  if (createHash("sha256").update(bytes).digest("hex") !== match[1]) throw new Error("Protocol artifact changed while snapshotting");
  await mkdir(dirname(new URL(match[2], destination).pathname), { recursive: true });
  await writeFile(new URL(match[2], destination), bytes);
}
await writeFile(new URL("SHA256SUMS", destination), inventory);
checksums.SHA256SUMS = createHash("sha256").update(inventory).digest("hex");
for (const file of ["schema.json", "README.md"]) {
  const bytes = await readFile(resolve(source, "artifacts/recorded-run-bundle-v1", file));
  checksums[file] = createHash("sha256").update(bytes).digest("hex");
  await writeFile(new URL(file, destination), bytes);
}
const { fixture, entriesFor, bundleFor, missingAccounting, completedGameplay } = await import(pathToFileURL(resolve(source, "tools/recorded-run/fixtures.mjs")));
for (const [name, value, compressed] of [["seed-readiness", fixture(), false], ["seed-readiness-deflate", fixture(), true], ["missing-accounting", missingAccounting(), false], ["completed-gameplay", completedGameplay(), false]]) {
  const bytes = bundleFor(value, compressed);
  checksums[`${name}.zip`] = createHash("sha256").update(bytes).digest("hex");
  await writeFile(new URL(`${name}.zip`, destination), bytes);
}
await writeFile(new URL("synthetic-entries.json", destination), JSON.stringify(Object.fromEntries([...entriesFor(fixture())].map(([name, bytes]) => [name, bytes.toString("utf8")])), null, 2) + "\n");
const large = fixture();
const template = large.events.find(record => record.payload.kind === "action_outcome");
large.events = [...large.events.filter(record => record.source.stream !== "trajectory"), ...Array.from({ length: 24997 }, (_, ordinal) => ({ ...structuredClone(template), source: { stream: "trajectory", record_ordinal: ordinal, subrecord_ordinal: 0 } }))];
Object.assign(large.report.streams.find(stream => stream.stream === "trajectory"), { input_records: 24997, emitted_rows: 24997, output_records: 24997 });
large.manifest.evidence.gameplay = "unknown";
const largeBytes = bundleFor(large, true);
await writeFile(new URL("browser-25000-records.zip", destination), largeBytes);
checksums["browser-25000-records.zip"] = createHash("sha256").update(largeBytes).digest("hex");
const observation = fixture();
observation.events.find(record => record.source.stream === "trajectory" && record.payload.kind === "decision_summary").payload.value.observation = {
  generation: "8", state_id_digest: "a".repeat(64), observation_digest: "b".repeat(64), legal_action_count: 3,
  player: { hp: "38", max_hp: "70", energy: "2", gold: "123" },
};
const observationBytes = bundleFor(observation, true);
await writeFile(new URL("browser-observation.zip", destination), observationBytes);
checksums["browser-observation.zip"] = createHash("sha256").update(observationBytes).digest("hex");
const artifact = JSON.parse(await readFile(new URL("manifest.json", destination), "utf8"));
await writeFile(new URL("studio-pin.json", destination), JSON.stringify({ status: "candidate-under-review", owner: "AI-Ascension/sts2-protocol", format_version: artifact.version, provenance: "Protocol synthetic fixtures; no Train source bytes", checksums }, null, 2) + "\n");
console.log(JSON.stringify(checksums, null, 2));
