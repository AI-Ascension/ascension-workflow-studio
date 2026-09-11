import Ajv from "ajv/dist/2020";
import schemaText from "../../../contracts/recorded-run-candidate/schema.json?raw";
import type { JsonObject, JsonValue } from "@studio/contracts";
import type { InspectionRecord, RecordingInspection } from "./model";
import { canonicalDocument, digest, encode, jcs, limits, requireImport } from "./primitives";
import { inspectZip, readEntry } from "./zip";
import { validateEvidence, validateSummary, validateIdentityPrivacy } from "./evidence";

export const schemaDigest = digest(encode(schemaText));
const schema = JSON.parse(schemaText) as { $id: string };
const ajv = new Ajv({ allErrors: false, strict: false });
ajv.addSchema(schema);
const validators = Object.fromEntries(["manifest", "record", "omissions"].map(kind => [kind, ajv.getSchema(`${schema.$id}#/$defs/${kind}`)!]));
const COMMON = "ai-ascension.recorded-run.common.v1";
const STS2 = "ai-ascension.sts2.seed-readiness.v1";
const supported = new Set([COMMON, STS2]);
const object = (value: JsonValue): JsonObject => value as JsonObject;
function validate(kind: string, value: JsonValue): JsonObject {
  function tokenStrings(item: JsonValue): void {
    if (typeof item === "string") requireImport(!/[\u0000-\u0020\u007f-\u009f]/u.test(item), "schema_mismatch", "Recording tokens cannot contain whitespace or control characters.");
    else if (item && typeof item === "object") Object.values(item).forEach(tokenStrings);
  }
  tokenStrings(value);
  requireImport(validators[kind](value), "schema_mismatch", `The ${kind} does not match the pinned recorded-run candidate schema.`);
  return object(value);
}

export async function importRecording(buffer: ArrayBuffer): Promise<RecordingInspection> {
  requireImport(buffer instanceof ArrayBuffer, "invalid_input", "Recording input must be an ArrayBuffer.");
  requireImport(buffer.byteLength <= limits.archive, "resource_limit", "Archive exceeds the 16 MiB browser limit.");
  const archive = new Uint8Array(buffer);
  const entries = inspectZip(archive);
  const manifestEntry = entries.find(entry => entry.path === "manifest.json");
  requireImport(manifestEntry && manifestEntry.bytes <= limits.manifest, "invalid_manifest", "A bounded root manifest.json is required.");
  const rawManifest = canonicalDocument(await readEntry(archive, manifestEntry), limits.manifest);
  const header = object(rawManifest);
  requireImport(header?.format_version === "1.0.0-candidate.2", "unsupported_version", "Only recorded-run 1.0.0-candidate.2 is supported.");
  const manifest = validate("manifest", rawManifest);
  validateIdentityPrivacy(object(object(manifest.recording).identities));
  requireImport(manifest.contract_schema_sha256 === schemaDigest, "contract_mismatch", "Bundle requires different contract bytes from this Studio build.");
  const required = manifest.required_profiles as string[], optional = manifest.optional_profiles as string[];
  const sorted = (values: string[]) => values.every((value, index) => index === 0 || values[index - 1] < value);
  requireImport(sorted(required) && sorted(optional), "invalid_manifest", "Profiles must be sorted and unique.");
  requireImport(required.includes(COMMON) && required.every(profile => supported.has(profile)), "unsupported_profile", "A required recording profile is unsupported.");
  requireImport(!required.some(profile => optional.includes(profile)), "invalid_manifest", "Required and optional profiles overlap.");
  const declarations = new Set([...required, ...optional]);
  const integrity = object(manifest.integrity);
  const semanticInput = { ...manifest, integrity: { ...integrity } };
  delete semanticInput.integrity.bundle_semantic_digest;
  const semanticDigest = digest(encode(jcs(semanticInput)));
  requireImport(semanticDigest === integrity.bundle_semantic_digest, "integrity_mismatch", "Manifest semantic digest does not match.");
  const declared = manifest.entries as JsonObject[];
  requireImport(sorted(declared.map(entry => entry.path as string)), "invalid_manifest", "Manifest entries must be sorted and unique.");
  requireImport(manifest.bundle_id === digest(encode(`ai-ascension.recorded-run.v1/bundle-id\0${jcs(object(manifest.recording).identity)}`)), "integrity_mismatch", "Bundle identity digest does not match the recording identity.");
  requireImport(new Set(declared.map(entry => entry.path)).size === declared.length && declared.length + 1 === entries.length, "invalid_manifest", "Manifest entry paths must be unique and match the archive exactly.");
  requireImport(declared.some(entry => entry.path === "records/events.ndjson") && declared.some(entry => entry.path === "reports/omissions.json"), "invalid_manifest", "Events and omissions entries are required.");
  const records: InspectionRecord[] = [], accounting: InspectionRecord[] = [];
  let omissions: JsonObject | undefined;
  const keys = new Set<string>();
  const admitted: JsonObject[] = [];
  const recordFiles = new Map<string, Uint8Array>();
  let remaining = limits.records;
  for (const declaration of declared) {
    const entry = entries.find(candidate => candidate.path === declaration.path);
    requireImport(entry && entry.bytes === declaration.bytes, "integrity_mismatch", "Declared entry is missing or has an incorrect size.");
    const isReport = entry.path === "reports/omissions.json";
    requireImport(declaration.media_type === (isReport ? "application/json" : "application/x-ndjson"), "invalid_manifest", "Entry media type does not match its role.");
    requireImport(!isReport || entry.bytes <= limits.report, "resource_limit", "Omissions report exceeds the 1 MiB limit.");
    const bytes = await readEntry(archive, entry);
    requireImport(digest(bytes) === declaration.sha256, "integrity_mismatch", "An entry SHA-256 does not match the manifest.");
    if (isReport) { omissions = validate("omissions", canonicalDocument(bytes, limits.report)); continue; }
    requireImport(bytes.length === 0 || bytes.at(-1) === 10, "truncated_records", "Every NDJSON record must end with LF.");
    let lineStart = 0;
    for (let end = 0; end < bytes.length; end++) {
      requireImport(end - lineStart <= limits.line, "resource_limit", "A record exceeds the 64 KiB limit.");
      if (bytes[end] !== 10) continue;
      requireImport(remaining > 0, "resource_limit", "Recording exceeds the 25,000-record limit.");
      remaining--; lineStart = end + 1;
    }
    recordFiles.set(entry.path, bytes);
  }
  // Both files have passed a shared count/line preflight before any record JSON
  // is materialized. Retain the parsing-time check as defense in depth.
  for (const [path, bytes] of recordFiles) {
    let start = 0;
    let previous: [string, number, number] | undefined;
    const subrecords = new Map<string, number>();
    for (let end = 0; end < bytes.length; end++) {
      requireImport(end - start <= limits.line, "resource_limit", "A record exceeds the 64 KiB limit.");
      if (bytes[end] !== 10) continue;
      requireImport(records.length + accounting.length < limits.records, "resource_limit", "Recording exceeds the 25,000-record limit.");
      const record = validate("record", canonicalDocument(bytes.subarray(start, end), limits.line));
      start = end + 1;
      const source = object(record.source), payload = object(record.payload);
      validateEvidence(record, manifest);
      const tuple: [string, number, number] = [source.stream as string, source.record_ordinal as number, source.subrecord_ordinal as number];
      const sourceKey = `${tuple[0]}:${tuple[1]}`;
      requireImport(tuple[2] === (subrecords.get(sourceKey) ?? 0), "record_order", "Subrecord ordinals must start at zero and be contiguous.");
      subrecords.set(sourceKey, tuple[2] + 1);
      requireImport(!previous || tuple[0] > previous[0] || tuple[0] === previous[0] && (tuple[1] > previous[1] || tuple[1] === previous[1] && tuple[2] > previous[2]), "record_order", "Records must be ordered by source stream, ordinal and subrecord ordinal.");
      previous = tuple;
      requireImport(declarations.has(payload.profile as string), "unsupported_profile", "Record payload profile is undeclared.");
      const key = `${source.stream}:${source.record_ordinal}:${source.subrecord_ordinal}`;
      requireImport(!keys.has(key), "duplicate_record", "Source stream, ordinal and subrecord identity is duplicated.");
      keys.add(key);
      const isAccounting = path === "records/accounting.ndjson";
      requireImport(isAccounting === (payload.kind === "accounting"), "invalid_accounting", "Accounting must appear only in the dedicated accounting entry.");
      const row: InspectionRecord = {
        key, kind: payload.kind as string, stream: source.stream as string,
        ordinal: source.record_ordinal as number, sequence: source.stream_sequence as string | undefined,
        timestamp: record.time ? object(record.time).unix_ns as string : undefined,
        unsupported: !supported.has(payload.profile as string) || payload.kind === "opaque",
        identities: object(record.identities), evidence: object(record.evidence), payload,
      };
      (isAccounting ? accounting : records).push(row);
      admitted.push(record);
    }
  }
  requireImport(omissions, "invalid_manifest", "An omissions report is required.");
  reconcile(omissions, [...records, ...accounting]);
  validateSummary(manifest, omissions, admitted);
  const compare = (a: InspectionRecord, b: InspectionRecord) => a.stream < b.stream ? -1 : a.stream > b.stream ? 1 : a.ordinal - b.ordinal || Number(a.key.split(":").at(-1)) - Number(b.key.split(":").at(-1));
  records.sort(compare); accounting.sort(compare);
  const recording = object(manifest.recording), identity = object(recording.identity);
  return {
    digest: semanticDigest, bundleIdentity: `${identity.namespace}:${identity.value}`,
    identities: object(recording.identities),
    provenance: { producer: manifest.producer, adapter: manifest.adapter, versions: manifest.versions, bundle_id: manifest.bundle_id, contract_schema_sha256: schemaDigest, format_version: manifest.format_version, fixture_provenance: omissions.fixture_provenance },
    completeness: { ...object(manifest.completeness), streams: omissions.streams },
    evidence: object(manifest.evidence), omissions, records, accounting,
    diagnostics: optional.filter(profile => !supported.has(profile)).map(profile => `Unsupported optional profile: ${profile}`),
  };
}

function reconcile(omissions: JsonObject, records: InspectionRecord[]): void {
  const streams = omissions.streams as JsonObject[];
  const known = new Set<string>();
  requireImport(streams.every((stream, index) => index === 0 || (streams[index - 1].stream as string) < (stream.stream as string)), "invalid_reconciliation", "Stream declarations must be sorted and unique.");
  requireImport(["trajectory", "decisions", "mcp", "provider-accounting", "result", "manifest"].every(name => streams.some(stream => stream.stream === name)), "invalid_reconciliation", "Required source stream dispositions are missing.");
  for (const stream of streams) {
    const name = stream.stream as string;
    requireImport(!known.has(name), "invalid_reconciliation", "Omissions stream is duplicated."); known.add(name);
    const rows = records.filter(record => record.stream === name);
    const ordinals = new Set(rows.map(record => record.ordinal));
    requireImport(rows.length === stream.output_records && ordinals.size === stream.emitted_rows, "invalid_reconciliation", "Emitted source rows or output counts do not reconcile.");
    if (["absent", "unknown"].includes(stream.state as string)) {
      requireImport(stream.input_records === null && ["emitted_rows", "filtered_rows", "unsupported_rows", "rejected_rows", "output_records"].every(key => stream[key] === 0) && (stream.dispositions as JsonValue[]).length === 0 && (stream.field_omissions as JsonValue[]).length === 0, "invalid_reconciliation", "Absent or unknown streams cannot contain source or output counts.");
      continue;
    }
    requireImport(stream.input_records !== null, "invalid_reconciliation", "Present stream requires an input count.");
    const counts = { filtered: 0, unsupported: 0, rejected: 0 };
    const covered = new Set(ordinals);
    let lastDisposition = -1;
    for (const disposition of stream.dispositions as JsonObject[]) {
      const dispositionClasses: Record<string, string> = {
        raw_mcp_disallowed: "filtered", private_source_metadata: "filtered",
        unsupported_source_event: "unsupported", unsupported_source_status: "unsupported",
        invalid_source_record: "rejected", partial_final_record: "rejected",
      };
      requireImport(dispositionClasses[disposition.reason as string] === disposition.disposition, "invalid_reconciliation", "Source disposition reason and class disagree.");
      if (disposition.reason === "raw_mcp_disallowed") requireImport(name === "mcp", "invalid_reconciliation", "Raw MCP disposition belongs only to the MCP stream.");
      if (disposition.reason === "private_source_metadata") requireImport(name === "manifest", "invalid_reconciliation", "Private source metadata disposition belongs only to the manifest stream.");
      if (disposition.reason === "unsupported_source_event") requireImport(name === "trajectory", "invalid_reconciliation", "Unsupported source events belong only to the trajectory stream.");
      if (disposition.reason === "unsupported_source_status") requireImport(["trajectory", "provider-accounting"].includes(name), "invalid_reconciliation", "Unsupported source status belongs only to trajectory or accounting.");
      const first = disposition.first as number, last = disposition.last as number;
      if (disposition.reason === "partial_final_record") requireImport(stream.state === "interrupted" && first === last && last === (stream.input_records as number) - 1, "invalid_reconciliation", "Partial source tail must be the interrupted stream's final singleton row.");
      requireImport(first <= last && first > lastDisposition && last < (stream.input_records as number), "invalid_reconciliation", "Invalid source disposition range.");
      lastDisposition = last;
      for (let ordinal = first; ordinal <= last; ordinal++) {
        requireImport(!covered.has(ordinal), "invalid_reconciliation", "Source dispositions overlap emitted rows or other dispositions.");
        covered.add(ordinal); counts[disposition.disposition as keyof typeof counts]++;
      }
    }
    requireImport([...covered].every(ordinal => ordinal < (stream.input_records as number)) && covered.size === stream.input_records && counts.filtered === stream.filtered_rows && counts.unsupported === stream.unsupported_rows && counts.rejected === stream.rejected_rows, "invalid_reconciliation", "Source disposition counts do not reconcile.");
    const fields = stream.field_omissions as JsonObject[];
    requireImport(fields.every(field => (field.affected_rows as number) <= (stream.input_records as number)) && new Set(fields.map(field => field.rule)).size === fields.length, "invalid_reconciliation", "Field omission counts or rules are inconsistent.");
    if (stream.state === "omitted") requireImport(stream.filtered_rows === stream.input_records, "invalid_reconciliation", "Omitted stream contains unfiltered rows.");
    if (stream.state === "unsupported") requireImport(stream.unsupported_rows === stream.input_records, "invalid_reconciliation", "Unsupported stream counts disagree.");
    if (stream.state === "interrupted") requireImport((stream.dispositions as JsonObject[]).some(d => d.reason === "partial_final_record" && d.disposition === "rejected" && d.first === d.last && d.last === (stream.input_records as number) - 1), "invalid_reconciliation", "Interrupted stream must identify its rejected final tail.");
    if (name === "mcp") requireImport(stream.emitted_rows === 0 && stream.filtered_rows === stream.input_records && (stream.dispositions as JsonObject[]).every(d => d.reason === "raw_mcp_disallowed"), "invalid_reconciliation", "Raw MCP records are not admitted by this profile.");
  }
  requireImport(records.every(record => known.has(record.stream)), "invalid_reconciliation", "A record stream has no omissions declaration.");
}
