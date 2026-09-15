import { parseBoundedJson } from "@studio/document";

export const CATALOG_RESPONSE_MAX_BYTES = 2 * 1024 * 1024;

/** Producer u64 tokens must be checked before JavaScript can round them. */
function assertCatalogNumericTokens(raw: string): void {
  const maximum = "9007199254740991";
  let quoted = false;
  for (let index = 0; index < raw.length; index += 1) {
    const character = raw[index];
    if (quoted) {
      if (character === "\\") index += 1;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') {
      quoted = true;
      continue;
    }
    if (character !== "-" && !/[0-9]/.test(character)) continue;
    const start = index;
    while (index + 1 < raw.length && /[0-9.eE+-]/.test(raw[index + 1])) index += 1;
    const token = raw.slice(start, index + 1);
    if (!/^(?:0|[1-9][0-9]*)$/.test(token)
      || token.length > maximum.length
      || (token.length === maximum.length && token > maximum)) {
      throw new Error("Context catalog numeric token must be a safe unsigned integer");
    }
  }
}

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
    const raw = parts.join("");
    assertCatalogNumericTokens(raw);
    return parseBoundedJson(raw);
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
}
