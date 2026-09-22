import { sha256 as nobleSha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

import { canonicalJson, canonicalJsonComplete } from "./json";
import type { SemanticDocument } from "./semantic-document";

export async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    const digest = await subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  // Insecure LAN origins (plain http on a LAN address) do not expose Web Crypto,
  // so fall back to the bundled implementation to keep validation and export working.
  return bytesToHex(nobleSha256(bytes));
}

export async function semanticDigest(document: SemanticDocument): Promise<string> {
  return sha256Hex(canonicalJson(document));
}

/**
 * Exact owner definition digest: SHA-256 over the complete canonical definition
 * including annotations. This is the identity the owner binds to target
 * admission and pins to a run.
 */
export async function definitionIdentityDigest(document: SemanticDocument): Promise<string> {
  return sha256Hex(canonicalJsonComplete(document));
}
