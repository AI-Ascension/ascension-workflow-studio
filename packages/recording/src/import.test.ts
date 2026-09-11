// @vitest-environment node
import { readFileSync } from "node:fs";
import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import type { JsonObject } from "@studio/contracts";
import { importRecording } from "./import";
import { canonicalDocument, digest, encode, jcs, limits } from "./primitives";
import { crc32, inspectZip } from "./zip";

const base = new URL("../../../contracts/recorded-run-candidate/", import.meta.url);
const buffer = (bytes: Uint8Array): ArrayBuffer => Uint8Array.from(bytes).buffer;
const fixture = (name = "seed-readiness.zip") => buffer(readFileSync(new URL(name, base)));
function entries(): Record<string, string> { return JSON.parse(readFileSync(new URL("synthetic-entries.json", base), "utf8")); }
function pack(values: Record<string, string>, compressed = false, trailingDeflate = false): ArrayBuffer {
  const locals: Buffer[] = [], directory: Buffer[] = [];
  let offset = 0;
  for (const [path, text] of Object.entries(values).sort(([a], [b]) => a < b ? -1 : 1)) {
    const raw = Buffer.from(text), name = Buffer.from(path), zipped = compressed ? deflateRawSync(raw) : raw;
    const body = trailingDeflate ? Buffer.concat([zipped, Buffer.from([0, 0, 0])]) : zipped;
    const local = Buffer.alloc(30), central = Buffer.alloc(46), crc = crc32(raw);
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(compressed ? 8 : 0, 8);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(name.length, 26);
    central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(compressed ? 8 : 0, 10);
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(body.length, 20); central.writeUInt32LE(raw.length, 24); central.writeUInt16LE(name.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, name, body); directory.push(central, name); offset += local.length + name.length + body.length;
  }
  const central = Buffer.concat(directory), end = Buffer.alloc(22), count = Object.keys(values).length;
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(count, 8); end.writeUInt16LE(count, 10); end.writeUInt32LE(central.length, 12); end.writeUInt32LE(offset, 16);
  return buffer(Buffer.concat([...locals, central, end]));
}
function reseal(values: Record<string, string>): void {
  const manifest = JSON.parse(values["manifest.json"]) as JsonObject;
  manifest.entries = Object.entries(values).filter(([name]) => name !== "manifest.json").sort(([a], [b]) => a < b ? -1 : 1).map(([path, text]) => ({ path, bytes: encode(text).length, media_type: path.endsWith(".ndjson") ? "application/x-ndjson" : "application/json", sha256: digest(encode(text)) }));
  const integrity = manifest.integrity as JsonObject;
  delete integrity.bundle_semantic_digest; integrity.bundle_semantic_digest = digest(encode(jcs(manifest)));
  values["manifest.json"] = jcs(manifest);
}
function alterRecord(values: Record<string, string>, entry: string, ordinal: number, change: (record: JsonObject) => void): void {
  const rows = values[entry].trimEnd().split("\n").map(text => JSON.parse(text) as JsonObject);
  change(rows[ordinal]); values[entry] = rows.map(row => jcs(row) + "\n").join(""); reseal(values);
}

describe("protocol candidate import", () => {
  const vectors = JSON.parse(readFileSync(new URL("conformance.json", base), "utf8")) as { cases: { path: string; valid: boolean; sha256: string }[] };
  it.each(vectors.cases)("matches protocol conformance $path", async vector => {
    const bytes = new Uint8Array(fixture(vector.path));
    expect(digest(bytes)).toBe(vector.sha256);
    if (vector.valid) await expect(importRecording(bytes.buffer)).resolves.toHaveProperty("digest");
    else await expect(importRecording(bytes.buffer)).rejects.toThrow();
  });
  it.each(["seed-readiness.zip", "seed-readiness-deflate.zip"])("imports exact protocol fixture %s with truthful evidence", async name => {
    const imported = await importRecording(fixture(name));
    expect(imported.records).toHaveLength(8); expect(imported.accounting).toHaveLength(1);
    expect(imported.evidence).toMatchObject({ process_exit: "completed", gameplay: "episode_failed", action: "unknown" });
    const receipts = imported.records.filter(record => record.kind === "action_outcome");
    expect(receipts.map(record => record.ordinal)).toEqual([2, 3]);
    expect(receipts.every(record => record.evidence.action === "unknown")).toBe(true);
    expect(imported.records[0].timestamp).toBe("1789090000123456789");
    expect(imported.records.find(record => record.identities.model_execution)?.identities.model_execution).toMatchObject({ namespace: "seed-readiness.trajectory.model-execution", value: "17" });
    expect(imported.accounting[0].identities.model_execution).toMatchObject({ namespace: "seed-readiness.accounting.model-execution", value: "different-execution" });
    expect((imported.accounting[0].payload.value as JsonObject).usage).toMatchObject({ cached_input_tokens: { value: null, value_status: "unknown" } });
  });
  it("preserves absent accounting and independently witnessed synthetic gameplay", async () => {
    expect((await importRecording(fixture("missing-accounting.zip"))).accounting).toEqual([]);
    expect((await importRecording(fixture("completed-gameplay.zip"))).evidence.gameplay).toBe("completed");
  });
  it("retains unknown optional profile metadata as an unsupported inert row", async () => {
    const values = entries(), manifest = JSON.parse(values["manifest.json"]);
    manifest.optional_profiles = ["example.optional.v1"]; values["manifest.json"] = jcs(manifest);
    alterRecord(values, "records/events.ndjson", 0, record => { record.payload = { profile: "example.optional.v1", kind: "opaque", value: { content_digest: "a".repeat(64), bytes: 15, media_type: "application/json" } }; });
    const imported = await importRecording(pack(values));
    expect(imported.records[0].unsupported).toBe(true); expect(imported.diagnostics).toHaveLength(1);
  });
  it.each([
    ["version", "unsupported_version"], ["schema", "contract_mismatch"], ["required-profile", "unsupported_profile"], ["tampered", "integrity_mismatch"], ["truncated", "truncated_records"], ["extra", "schema_mismatch"], ["reconciliation", "invalid_reconciliation"], ["settlement", "evidence_mismatch"], ["namespace", "evidence_mismatch"], ["unknown-zero", "evidence_mismatch"], ["summary", "evidence_mismatch"], ["duplicate", "record_order"],
  ])("rejects %s even when ZIP checksums are recomputed", async (mutation, code) => {
    const values = entries();
    if (["version", "schema", "required-profile", "summary"].includes(mutation)) {
      const manifest = JSON.parse(values["manifest.json"]);
      if (mutation === "version") manifest.format_version = "2.0.0";
      if (mutation === "schema") manifest.contract_schema_sha256 = "0".repeat(64);
      if (mutation === "required-profile") manifest.required_profiles.push("z.unknown");
      if (mutation === "summary") manifest.evidence.gameplay = "completed";
      values["manifest.json"] = jcs(manifest); reseal(values);
    }
    if (mutation === "tampered") values["records/events.ndjson"] = values["records/events.ndjson"].replace("unknown", "settled");
    if (mutation === "truncated") { values["records/events.ndjson"] = values["records/events.ndjson"].trimEnd(); reseal(values); }
    if (mutation === "extra") alterRecord(values, "records/events.ndjson", 0, record => { record.private_prompt = "SYNTHETIC_SENTINEL_SECRET"; });
    if (mutation === "reconciliation") { const report = JSON.parse(values["reports/omissions.json"]); report.streams[0].emitted_rows = 0; values["reports/omissions.json"] = jcs(report); reseal(values); }
    if (mutation === "settlement") alterRecord(values, "records/events.ndjson", 4, record => { ((record.payload as JsonObject).value as JsonObject).status = "settled"; (record.evidence as JsonObject).action = "settled"; });
    if (mutation === "namespace") alterRecord(values, "records/accounting.ndjson", 0, record => { ((record.identities as JsonObject).model_execution as JsonObject).namespace = "seed-readiness.trajectory.model-execution"; });
    if (mutation === "unknown-zero") alterRecord(values, "records/accounting.ndjson", 0, record => { ((((record.payload as JsonObject).value as JsonObject).usage as JsonObject).cached_input_tokens as JsonObject).value = "0"; });
    if (mutation === "duplicate") { const line = values["records/events.ndjson"].split("\n")[0]; values["records/events.ndjson"] = line + "\n" + values["records/events.ndjson"]; reseal(values); }
    await expect(importRecording(pack(values))).rejects.toMatchObject({ code });
  });
  it("rejects unsafe paths, inconsistent headers, archive bombs and trailing DEFLATE data", async () => {
    expect(() => inspectZip(new Uint8Array(pack({ "../bad": "{}" })))).toThrow();
    const bytes = new Uint8Array(fixture()); bytes[8] = 9;
    expect(() => inspectZip(bytes)).toThrow();
    expect(() => inspectZip(new Uint8Array(limits.archive + 1))).toThrow();
    await expect(importRecording(pack(entries(), true, true))).rejects.toThrow();
  });
  it("rejects excessive actual inflation before records can be admitted", async () => {
    const bytes = new Uint8Array(pack({ "manifest.json": "x".repeat(300_000) }, true));
    const view = new DataView(bytes.buffer); const end = bytes.length - 22, central = view.getUint32(end + 16, true);
    view.setUint32(22, 100, true); view.setUint32(central + 24, 100, true);
    await expect(importRecording(bytes.buffer)).rejects.toMatchObject({ code: "resource_limit" });
  });
  it("rejects oversized lines before JSON decoding", async () => {
    const values = entries(); values["records/events.ndjson"] = '"' + "x".repeat(limits.line) + '"\n'; reseal(values);
    await expect(importRecording(pack(values))).rejects.toMatchObject({ code: "resource_limit" });
  });
  it("enforces the combined record count across event and accounting files", async () => {
    const values = entries();
    const template = JSON.parse(values["records/events.ndjson"].split("\n")[4]) as JsonObject;
    const lines: string[] = [];
    for (let ordinal = 0; ordinal < limits.records; ordinal++) {
      template.source = { stream: "trajectory", record_ordinal: ordinal, subrecord_ordinal: 0 };
      lines.push(jcs(template) + "\n");
    }
    values["records/events.ndjson"] = lines.join(""); reseal(values);
    await expect(importRecording(pack(values, true))).rejects.toMatchObject({ code: "resource_limit" });
  }, 20_000);
});
describe("bounded RFC 8785 bytes", () => {
  it("orders integer-like keys, preserves annotations and rejects lost parser information", () => {
    expect(jcs({ "2": "two", "10": "ten", annotations: { keep: true } })).toBe('{"10":"ten","2":"two","annotations":{"keep":true}}');
    expect(digest(encode("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    for (const text of ['{"x":1,"x":2}', '{"x":1,"\\u0078":2}', '{"x":"\\ud800"}', '{"x":9007199254740993}', '{"x":-0}', '{"x":1}\n', '['.repeat(34) + '0' + ']'.repeat(34)]) expect(() => canonicalDocument(encode(text), 1024)).toThrow();
    expect(() => canonicalDocument(new Uint8Array([255]), 1024)).toThrow();
    expect(() => canonicalDocument(encode("[".repeat(33) + "]".repeat(33)), 1024)).toThrow();
  });
});
