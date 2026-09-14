import { parseBoundedJson } from "@studio/document";

export const CATALOG_RESPONSE_MAX_BYTES = 2 * 1024 * 1024;

/** The byte cap applies while reading, independently of Content-Length. */
export async function readContextCatalogBody(response: Response): Promise<unknown> {
  if (!response.body) throw new Error("Context catalog response body is unavailable");
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0;
  const parts: string[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value.byteLength === 0) continue;
      size += value.byteLength;
      if (size > CATALOG_RESPONSE_MAX_BYTES) throw new Error("Context catalog response exceeds the byte guard");
      parts.push(decoder.decode(value, { stream: true }));
    }
    parts.push(decoder.decode());
    return parseBoundedJson(parts.join(""));
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
}
