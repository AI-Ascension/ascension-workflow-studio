export interface RecordingCatalogEntry {
  id: string;
  file: string;
  bundle_sha256: string;
  semantic_digest: string;
  event_records: number;
  accounting_records: number;
  source: string;
}

const DIGEST = /^[a-f0-9]{64}$/;
const RUN = /^linux-[a-f0-9]{32}$/;

export function catalogEntries(value: unknown): RecordingCatalogEntry[] {
  if (!value || typeof value !== "object") throw new Error("The recording catalog is invalid.");
  const entries = (value as { entries?: unknown }).entries;
  if (!Array.isArray(entries) || entries.length > 100) throw new Error("The recording catalog is invalid.");
  return entries.map((entry): RecordingCatalogEntry => {
    if (!entry || typeof entry !== "object") throw new Error("The recording catalog is invalid.");
    const item = entry as Record<string, unknown>;
    if (typeof item.id !== "string" || !RUN.test(item.id)
      || typeof item.file !== "string" || item.file !== `${item.id}.zip`
      || typeof item.bundle_sha256 !== "string" || !DIGEST.test(item.bundle_sha256)
      || typeof item.semantic_digest !== "string" || !DIGEST.test(item.semantic_digest)
      || !Number.isSafeInteger(item.event_records) || (item.event_records as number) < 0
      || !Number.isSafeInteger(item.accounting_records) || (item.accounting_records as number) < 0
      || typeof item.source !== "string" || item.source !== "sanitized_train_export") {
      throw new Error("The recording catalog is invalid.");
    }
    return {
      id: item.id as string,
      file: item.file as string,
      bundle_sha256: item.bundle_sha256 as string,
      semantic_digest: item.semantic_digest as string,
      event_records: item.event_records as number,
      accounting_records: item.accounting_records as number,
      source: item.source as string,
    };
  });
}

export function catalogUrl(entry: RecordingCatalogEntry): string {
  return `/recordings/${encodeURIComponent(entry.file)}`;
}
