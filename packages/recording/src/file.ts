import { importRecording } from "./import";
import { limits, requireImport } from "./primitives";

/** Keep the size gate at the worker boundary, before File.arrayBuffer allocates. */
export async function importRecordingFile(file: Pick<Blob, "size" | "arrayBuffer">) {
  requireImport(Number.isSafeInteger(file.size) && file.size >= 0 && file.size <= limits.archive, "resource_limit", "Archive exceeds the 16 MiB browser limit.");
  const bytes = await file.arrayBuffer();
  requireImport(bytes.byteLength === file.size, "invalid_input", "File size changed while reading.");
  return importRecording(bytes);
}
