// Snapshot protocol-owned candidate bytes and synthetic fixtures; never writes to source.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
const source = resolve(process.argv[2]);
const artifactDirectory = process.argv[3];
if (!/^recorded-run-bundle-v1(?:-candidate[0-9]+)?$/.test(artifactDirectory ?? "")) throw new Error("Supply the protocol artifact directory name explicitly");
const artifactSource = resolve(source, "artifacts", artifactDirectory);
const destination = new URL("../contracts/recorded-run-candidate/", import.meta.url);
const checksums = {};
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const inventory = await readFile(resolve(artifactSource, "SHA256SUMS"));
if (hash(inventory) !== process.argv[4]) throw new Error("Artifact inventory does not match the owner-supplied pin");
const verified = new Map();
for (const line of inventory.toString("utf8").trim().split("\n")) {
  const match = /^([a-f0-9]{64})  ([a-zA-Z0-9_.\/-]+)$/.exec(line);
  if (!match || match[2].split("/").includes("..") || match[2].startsWith("/")) throw new Error("Unsafe artifact inventory");
  const bytes = await readFile(resolve(artifactSource, match[2]));
  if (createHash("sha256").update(bytes).digest("hex") !== match[1]) throw new Error("Protocol artifact changed while snapshotting");
  if (verified.has(match[2])) throw new Error("Duplicate artifact entry");
  verified.set(match[2], bytes);
}
if (!verified.has("schema.json") || hash(verified.get("schema.json")) !== process.argv[5]) throw new Error("Schema does not match the owner-supplied pin");
await mkdir(destination, { recursive: true });
for (const [name, bytes] of verified) {
  await mkdir(dirname(new URL(name, destination).pathname), { recursive: true });
  await writeFile(new URL(name, destination), bytes);
}
await writeFile(new URL("SHA256SUMS", destination), inventory);
checksums.SHA256SUMS = createHash("sha256").update(inventory).digest("hex");
for (const file of ["schema.json", "README.md"]) {
  const bytes = verified.get(file);
  checksums[file] = createHash("sha256").update(bytes).digest("hex");
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
