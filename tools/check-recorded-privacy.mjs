// Reproduce the independent review's four probes, plus both roles in every branch.
// Protocol source may be the preserved candidate2 history or the current candidate.
import { createServer } from "vite";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
const source = resolve(process.argv[2]);
const moduleAt = name => import(pathToFileURL(resolve(source, `tools/recorded-run/${name}.mjs`)));
const { fixture, completedGameplay, entriesFor } = await moduleAt("fixtures");
const { optionalUnknown } = await moduleAt("cases");
const { writeZip } = await moduleAt("zip");
const { validateBundle } = await moduleAt("validate");
const server = await createServer({ root: process.cwd(), server: { middlewareMode: true }, appType: "custom" });
const output = resolve("contracts/recorded-run-candidate/studio-invalid");
const evidence = resolve("docs/evidence/recorded-run-local");
const results = [];
try {
  const { importRecording } = await server.ssrLoadModule("/packages/recording/src/import.ts");
  const buffer = bytes => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  await mkdir(output, { recursive: true }); await mkdir(evidence, { recursive: true });
  for (const [placement, factory] of [["manifest", fixture], ["common-gameplay", completedGameplay], ["opaque", optionalUnknown]]) {
    const valid = writeZip(entriesFor(factory()));
    validateBundle(valid); await importRecording(buffer(valid)); // Rejecting version/hash alone cannot pass this probe.
    for (const role of ["action", "provider_request"]) {
      const value = factory();
      const identities = placement === "manifest" ? value.manifest.recording.identities : placement === "common-gameplay" ? value.events.at(-1).identities : value.events[0].identities;
      identities[role] = { namespace: "raw", value: "secret" }; // Exact synthetic reviewer value; never source credentials.
      const bytes = writeZip(entriesFor(value));
      let studio = "accepted", oracle = "accepted";
      try { await importRecording(buffer(bytes)); } catch (error) { studio = error.code; }
      try { validateBundle(bytes); } catch (error) { oracle = error.message; }
      assert.equal(studio, "evidence_mismatch"); assert.equal(oracle, `${role}_privacy`);
      const name = `${placement}-${role}.zip`;
      await writeFile(resolve(output, name), bytes);
      results.push({ name, studio, oracle, sha256: createHash("sha256").update(bytes).digest("hex"), format_version: value.manifest.format_version });
    }
  }
  await writeFile(resolve(evidence, "privacy-comparison.json"), JSON.stringify({ scope: "synthetic independent-review reproductions; three valid baselines accepted by both decoders", results }, null, 2) + "\n");
  console.log(JSON.stringify(results, null, 2));
} finally { await server.close(); }
