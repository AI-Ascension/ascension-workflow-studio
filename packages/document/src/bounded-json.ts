import { type JsonObject, type JsonValue, WorkflowDefinitionSchema } from "@studio/contracts";

import { isJsonRecord } from "./json";
import { isOwnerNodeKind } from "./owner-nodes";
import type { SemanticDocument } from "./semantic-document";

export interface JsonImportLimits {
  maxBytes: number;
  maxDepth: number;
  maxNodes: number;
  maxStringBytes: number;
}

const defaultJsonImportLimits: JsonImportLimits = {
  maxBytes: 2 * 1024 * 1024,
  maxDepth: 32,
  maxNodes: 20_000,
  maxStringBytes: 64 * 1024,
};

export type DefinitionImport =
  | { kind: "supported"; document: SemanticDocument }
  | {
    kind: "archival";
    schemaVersion: string;
    /** Parsed only for bounded classification. Never use this as a serialization source. */
    raw: JsonValue;
    /** The exact caller-provided JSON text, retained solely for read-only archival display/export. */
    rawText: string;
    reason: string;
  };

export function parseBoundedJson(raw: string, requestedLimits: Partial<JsonImportLimits> = {}): JsonValue {
  const limits = { ...defaultJsonImportLimits, ...requestedLimits };
  const bytes = new TextEncoder().encode(raw).byteLength;
  if (bytes > limits.maxBytes) {
    throw new Error(`JSON input exceeds the ${limits.maxBytes}-byte limit`);
  }
  return new BoundedJsonParser(raw, limits).parse();
}

export function parseDefinitionImport(raw: string, requestedLimits: Partial<JsonImportLimits> = {}): DefinitionImport {
  const parsed = parseBoundedJson(raw, requestedLimits);
  if (!isJsonRecord(parsed)) {
    throw new Error("workflow import must be a JSON object");
  }
  const schemaVersion = typeof parsed.schema_version === "string" ? parsed.schema_version : "unknown";
  if (schemaVersion !== "ascension.workflow/v1") {
    return {
      kind: "archival",
      schemaVersion,
      raw: parsed,
      rawText: raw,
      reason: "This schema version is unsupported by the active owner contract; the raw bytes remain read-only.",
    };
  }
  const unknownKinds = unknownNodeKinds(parsed);
  if (unknownKinds.length > 0) {
    return {
      kind: "archival",
      schemaVersion,
      raw: parsed,
      rawText: raw,
      reason: `This definition contains unsupported owner node kind${unknownKinds.length === 1 ? "" : "s"} (${unknownKinds.join(", ")}); the raw bytes remain read-only.`,
    };
  }
  return { kind: "supported", document: WorkflowDefinitionSchema.parse(parsed) };
}

export function unknownNodeKinds(value: JsonObject): string[] {
  const graphs = value.graphs;
  if (!Array.isArray(graphs)) return [];
  const kinds = new Set<string>();
  for (const graph of graphs) {
    if (graph === null || typeof graph !== "object" || Array.isArray(graph)) continue;
    const nodes = (graph as JsonObject).nodes;
    if (!Array.isArray(nodes)) continue;
    for (const node of nodes) {
      if (node === null || typeof node !== "object" || Array.isArray(node)) continue;
      const kind = (node as JsonObject).kind;
      if (typeof kind === "string" && !isOwnerNodeKind(kind)) kinds.add(kind);
    }
  }
  return [...kinds].sort();
}

class BoundedJsonParser {
  private index = 0;
  private nodes = 0;

  public constructor(private readonly source: string, private readonly limits: JsonImportLimits) {}

  public parse(): JsonValue {
    this.skipWhitespace();
    if (this.index >= this.source.length) {
      throw new Error("JSON input is empty");
    }
    const value = this.parseValue(0);
    this.skipWhitespace();
    if (this.index !== this.source.length) {
      throw new Error(`JSON input has trailing data at offset ${this.index}`);
    }
    return value;
  }

  private parseValue(depth: number): JsonValue {
    this.nodes += 1;
    if (this.nodes > this.limits.maxNodes) {
      throw new Error(`JSON input exceeds the ${this.limits.maxNodes}-node limit`);
    }
    if (depth > this.limits.maxDepth) {
      throw new Error(`JSON input exceeds the ${this.limits.maxDepth}-level nesting limit`);
    }
    this.skipWhitespace();
    const character = this.source[this.index];
    if (character === '"') return this.parseString();
    if (character === "{") return this.parseObject(depth);
    if (character === "[") return this.parseArray(depth);
    if (this.source.startsWith("true", this.index)) {
      this.index += 4;
      return true;
    }
    if (this.source.startsWith("false", this.index)) {
      this.index += 5;
      return false;
    }
    if (this.source.startsWith("null", this.index)) {
      this.index += 4;
      return null;
    }
    return this.parseNumber();
  }

  private parseString(): string {
    const start = this.index;
    this.index += 1;
    let escaped = false;
    while (this.index < this.source.length) {
      const character = this.source[this.index];
      if (character === "\n" || character === "\r") {
        throw new Error(`JSON string contains an unescaped line break at offset ${this.index}`);
      }
      if (escaped) {
        escaped = false;
        this.index += 1;
        continue;
      }
      if (character === "\\") {
        escaped = true;
        this.index += 1;
        continue;
      }
      if (character === '"') {
        this.index += 1;
        const encoded = this.source.slice(start, this.index);
        if (new TextEncoder().encode(encoded).byteLength > this.limits.maxStringBytes) {
          throw new Error(`JSON string exceeds the ${this.limits.maxStringBytes}-byte limit`);
        }
        const value: unknown = JSON.parse(encoded);
        if (typeof value !== "string") {
          throw new Error(`JSON string is invalid at offset ${start}`);
        }
        return value;
      }
      this.index += 1;
    }
    throw new Error(`JSON string is unterminated at offset ${start}`);
  }

  private parseObject(depth: number): JsonObject {
    this.index += 1;
    const output = Object.create(null) as JsonObject;
    const keys = new Set<string>();
    this.skipWhitespace();
    if (this.source[this.index] === "}") {
      this.index += 1;
      return output;
    }
    while (this.index < this.source.length) {
      this.skipWhitespace();
      if (this.source[this.index] !== '"') {
        throw new Error(`JSON object key expected at offset ${this.index}`);
      }
      const key = this.parseString();
      if (keys.has(key)) {
        throw new Error(`JSON object contains a duplicate key: ${key}`);
      }
      keys.add(key);
      this.skipWhitespace();
      if (this.source[this.index] !== ":") {
        throw new Error(`JSON object colon expected at offset ${this.index}`);
      }
      this.index += 1;
      output[key] = this.parseValue(depth + 1);
      this.skipWhitespace();
      if (this.source[this.index] === "}") {
        this.index += 1;
        return output;
      }
      if (this.source[this.index] !== ",") {
        throw new Error(`JSON object separator expected at offset ${this.index}`);
      }
      this.index += 1;
    }
    throw new Error("JSON object is unterminated");
  }

  private parseArray(depth: number): JsonValue[] {
    this.index += 1;
    const output: JsonValue[] = [];
    this.skipWhitespace();
    if (this.source[this.index] === "]") {
      this.index += 1;
      return output;
    }
    while (this.index < this.source.length) {
      output.push(this.parseValue(depth + 1));
      this.skipWhitespace();
      if (this.source[this.index] === "]") {
        this.index += 1;
        return output;
      }
      if (this.source[this.index] !== ",") {
        throw new Error(`JSON array separator expected at offset ${this.index}`);
      }
      this.index += 1;
      this.skipWhitespace();
      if (this.source[this.index] === "]") {
        throw new Error(`JSON array has a trailing comma at offset ${this.index}`);
      }
    }
    throw new Error("JSON array is unterminated");
  }

  private parseNumber(): number {
    const remainder = this.source.slice(this.index);
    const match = remainder.match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);
    if (!match) {
      throw new Error(`JSON value is invalid at offset ${this.index}`);
    }
    const token = match[0];
    const value = Number(token);
    if (!Number.isFinite(value)) {
      throw new Error(`JSON number is not finite at offset ${this.index}`);
    }
    if (/^-?\d+$/.test(token) && !Number.isSafeInteger(value)) {
      throw new Error(`JSON integer is outside the safe range at offset ${this.index}`);
    }
    this.index += token.length;
    return value;
  }

  private skipWhitespace(): void {
    while (/\s/.test(this.source[this.index] ?? "")) {
      this.index += 1;
    }
  }
}
