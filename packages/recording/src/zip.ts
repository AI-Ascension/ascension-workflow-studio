import { decode, ImportFailure, limits, requireImport } from "./primitives";

export interface ZipEntry { path: string; bytes: number; compressed: number; method: number; crc: number; start: number }
export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
export function safePath(path: string): boolean {
  return path.length <= 128 && /^(?:[a-z0-9][a-z0-9_-]{0,31}\/)*[a-z0-9][a-z0-9_.-]{0,63}$/.test(path);
}
/** Restrictive classic ZIP reader: no extraction, descriptors, links, extras or hidden bytes. */
export function inspectZip(data: Uint8Array): ZipEntry[] {
  requireImport(data.byteLength <= limits.archive, "resource_limit", "Archive exceeds the 16 MiB browser limit.");
  requireImport(data.byteLength >= 22, "invalid_zip", "Archive is truncated.");
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const end = data.byteLength - 22;
  const u16 = (offset: number) => view.getUint16(offset, true);
  const u32 = (offset: number) => view.getUint32(offset, true);
  const valid = (condition: unknown) => requireImport(condition, "invalid_zip", "Archive structure is unsupported, inconsistent or unsafe.");
  valid(u32(end) === 0x06054b50 && u16(end + 4) === 0 && u16(end + 6) === 0 && u16(end + 20) === 0);
  const count = u16(end + 10), directory = u32(end + 16);
  valid(count > 0 && count === u16(end + 8));
  requireImport(count <= limits.entries, "resource_limit", "Archive contains too many entries.");
  valid(directory <= end && directory + u32(end + 12) === end);
  let cursor = directory, total = 0, localEnd = 0;
  const entries: ZipEntry[] = [], paths = new Set<string>();
  const ranges: { start: number; end: number }[] = [];
  for (let index = 0; index < count; index++) {
    valid(cursor + 46 <= end && u32(cursor) === 0x02014b50);
    const flags = u16(cursor + 8), method = u16(cursor + 10);
    const compressed = u32(cursor + 20), bytes = u32(cursor + 24);
    const nameLength = u16(cursor + 28), extraLength = u16(cursor + 30), commentLength = u16(cursor + 32);
    const local = u32(cursor + 42), attributes = u32(cursor + 38), crc = u32(cursor + 16);
    valid((flags === 0 || flags === 0x800) && (method === 0 || method === 8) && u16(cursor + 6) === 20);
    valid(extraLength === 0 && commentLength === 0 && u16(cursor + 34) === 0 && u16(cursor + 36) === 0);
    const made = u16(cursor + 4);
    valid((made === 20 && attributes === 0) || (made === 0x314 && attributes === 0x81a40000));
    valid(cursor + 46 + nameLength <= end);
    const path = decode(data.subarray(cursor + 46, cursor + 46 + nameLength));
    valid(safePath(path) && !paths.has(path));
    paths.add(path);
    total += bytes;
    requireImport(bytes <= limits.entry && total <= limits.extracted, "resource_limit", "Archive exceeds extracted byte limits.");
    requireImport(path !== "manifest.json" || bytes <= limits.manifest, "resource_limit", "Manifest exceeds supported byte limit.");
    requireImport(path !== "reports/omissions.json" || bytes <= limits.report, "resource_limit", "Omissions exceed supported byte limit.");
    valid(local === localEnd);
    valid(local + 30 <= directory && u32(local) === 0x04034b50);
    valid(u16(local + 4) === 20 && u16(local + 6) === flags && u16(local + 8) === method && u32(local + 10) === u32(cursor + 12));
    valid(u32(local + 14) === crc && u32(local + 18) === compressed && u32(local + 22) === bytes);
    valid(u16(local + 26) === nameLength && u16(local + 28) === 0);
    const start = local + 30 + nameLength;
    valid(start <= directory && start + compressed <= directory);
    valid(decode(data.subarray(local + 30, start)) === path);
    if (method === 0) valid(compressed === bytes);
    entries.push({ path, bytes, compressed, method, crc, start });
    ranges.push({ start: local, end: start + compressed });
    localEnd = start + compressed;
    cursor += 46 + nameLength;
  }
  valid(cursor === end);
  ranges.sort((a, b) => a.start - b.start);
  let previous = 0;
  for (const range of ranges) { valid(range.start === previous); previous = range.end; }
  valid(previous === directory);
  return entries;
}

export async function readEntry(archive: Uint8Array<ArrayBuffer>, entry: ZipEntry): Promise<Uint8Array<ArrayBuffer>> {
  const compressed = archive.subarray(entry.start, entry.start + entry.compressed);
  let result: Uint8Array<ArrayBuffer>;
  if (entry.method === 0) result = compressed;
  else {
    requireImport(typeof DecompressionStream !== "undefined", "browser_unsupported", "This browser does not support DEFLATE import.");
    const reader = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.byteLength;
        requireImport(size <= entry.bytes && size <= limits.entry, "resource_limit", "Inflated data exceeds declared or supported size.");
        chunks.push(next.value);
      }
    } catch (error) {
      await reader.cancel().catch(() => undefined);
      if (error instanceof ImportFailure) throw error;
      throw new ImportFailure("invalid_zip", "DEFLATE data is malformed or truncated.");
    }
    result = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  }
  requireImport(result.byteLength === entry.bytes && crc32(result) === entry.crc, "integrity_mismatch", "Archive entry size or CRC does not match.");
  return result;
}
