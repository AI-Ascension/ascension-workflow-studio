import {
  LayoutSidecarSchema,
  type JsonObject,
  type JsonValue,
  type LayoutSidecar,
  type WorkflowDefinition,
  type WorkflowEdge,
  type WorkflowNode,
  WorkflowDefinitionSchema,
} from "@studio/contracts";

export type SemanticDocument = WorkflowDefinition;

export interface StudioFlowNode {
  id: string;
  position: { x: number; y: number };
  data: {
    label: string;
    kind: string;
    qualifiedId: string;
    locked: boolean;
  };
}

export interface StudioFlowEdge {
  id: string;
  source: string;
  target: string;
  label: string;
  data: { qualifiedSource: string; qualifiedTarget: string };
}

export interface DocumentBundle {
  semantic: SemanticDocument;
  layout: LayoutSidecar;
}

export interface StudioBundleEnvelope {
  bundleVersion: "ascension.studio-bundle/v1";
  semanticDigest: string;
  semantic: SemanticDocument;
  layout: LayoutSidecar;
}

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

export interface MergeConflict {
  path: string;
  base: JsonValue | undefined;
  local: JsonValue | undefined;
  remote: JsonValue | undefined;
}

export interface DocumentMergeResult {
  document: SemanticDocument | undefined;
  conflicts: MergeConflict[];
  changedPaths: string[];
}

export interface LayoutMergeResult {
  layout: LayoutSidecar | undefined;
  conflicts: MergeConflict[];
}

export interface NodeClipboard {
  sourceGraphId: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

export interface PasteResult {
  document: SemanticDocument;
  selectedIds: string[];
  idMap: Record<string, string>;
}

export interface DocumentChange {
  path: string;
  before: JsonValue | undefined;
  after: JsonValue | undefined;
}

export function cloneDocument(document: SemanticDocument): SemanticDocument {
  return WorkflowDefinitionSchema.parse(JSON.parse(JSON.stringify(document)) as unknown);
}

export function canonicalize(value: unknown): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("canonical JSON does not permit non-finite numbers");
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item));
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const output = Object.create(null) as JsonObject;
    for (const key of Object.keys(record).sort()) {
      if (key === "annotations") {
        continue;
      }
      output[key] = canonicalize(record[key]);
    }
    return output;
  }
  throw new Error("canonical JSON contains an unsupported value");
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

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
  return { kind: "supported", document: WorkflowDefinitionSchema.parse(parsed) };
}

function isJsonRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

export async function sha256Hex(value: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error("Web Crypto SHA-256 is unavailable in this context");
  }
  const bytes = new TextEncoder().encode(value);
  const digest = await subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function semanticDigest(document: SemanticDocument): Promise<string> {
  return sha256Hex(canonicalJson(document));
}

export async function serializeStudioBundle(bundle: DocumentBundle): Promise<string> {
  const digest = await semanticDigest(bundle.semantic);
  if (bundle.layout.semanticDigest !== digest || !layoutIsValid(bundle.semantic, bundle.layout)) {
    throw new Error("cannot export a bundle with an unbound or invalid layout sidecar");
  }
  assertNoSecretLikeKeys(bundle.semantic);
  const envelope: StudioBundleEnvelope = {
    bundleVersion: "ascension.studio-bundle/v1",
    semanticDigest: digest,
    semantic: cloneDocument(bundle.semantic),
    layout: LayoutSidecarSchema.parse(bundle.layout),
  };
  return JSON.stringify(envelope, null, 2);
}

export async function parseStudioBundle(raw: string): Promise<DocumentBundle> {
  const parsed = parseBoundedJson(raw);
  if (!isJsonRecord(parsed)) {
    throw new Error("Studio bundle must be a JSON object");
  }
  const record = parsed;
  if (record.bundleVersion !== "ascension.studio-bundle/v1") {
    throw new Error("Studio bundle version is unsupported");
  }
  const semantic = WorkflowDefinitionSchema.parse(record.semantic);
  const layout = LayoutSidecarSchema.parse(record.layout);
  assertNoSecretLikeKeys(semantic);
  const digest = await semanticDigest(semantic);
  if (record.semanticDigest !== digest || layout.semanticDigest !== digest) {
    throw new Error("Studio bundle semantic digest does not match its content");
  }
  if (!layoutIsValid(semantic, layout)) {
    throw new Error("Studio bundle layout contains an unknown or missing node binding");
  }
  return { semantic, layout };
}

function assertNoSecretLikeKeys(value: unknown, path = "$"): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSecretLikeKeys(item, `${path}[${index}]`));
    return;
  }
  if (typeof value !== "object" || value === null) {
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (/(?:^|[_-])(token|secret|password|api[_-]?key|private[_-]?key)(?:$|[_-])/i.test(key) || /^(token|secret|password|apikey|privatekey)$/i.test(key)) {
      throw new Error("Studio bundle refuses secret-like field " + path + "." + key);
    }
    assertNoSecretLikeKeys(child, `${path}.${key}`);
  }
}

export function qualifiedNodeId(graphId: string, nodeId: string): string {
  if (!/^[A-Za-z0-9._:-]+$/.test(graphId) || !/^[A-Za-z0-9._:-]+$/.test(nodeId)) {
    throw new Error("graph and node IDs must use the qualified identifier alphabet");
  }
  return `${graphId}:${nodeId}`;
}

export function createLayout(document: SemanticDocument, digest: string): LayoutSidecar {
  const positions: LayoutSidecar["positions"] = {};
  for (const [graphIndex, graph] of document.graphs.entries()) {
    for (const [nodeIndex, node] of graph.nodes.entries()) {
      positions[qualifiedNodeId(graph.id, node.id)] = {
        x: 72 + (nodeIndex % 4) * 248,
        y: 84 + graphIndex * 260 + Math.floor(nodeIndex / 4) * 168,
      };
    }
  }
  return LayoutSidecarSchema.parse({
    schemaVersion: "ascension.studio-layout/v1",
    semanticDigest: digest,
    positions,
  });
}

export function createFlowProjection(bundle: DocumentBundle): {
  nodes: StudioFlowNode[];
  edges: StudioFlowEdge[];
} {
  const nodes: StudioFlowNode[] = [];
  const edges: StudioFlowEdge[] = [];
  for (const graph of bundle.semantic.graphs) {
    for (const node of graph.nodes) {
      const qualifiedId = qualifiedNodeId(graph.id, node.id);
      nodes.push({
        id: qualifiedId,
        position: bundle.layout.positions[qualifiedId] ?? { x: 80, y: 80 },
        data: {
          label: node.id,
          kind: node.kind,
          qualifiedId,
          locked: node.kind === "adaptive_region",
        },
      });
    }
    for (const edge of graph.edges) {
      const source = qualifiedNodeId(graph.id, edge.from);
      const target = qualifiedNodeId(graph.id, edge.to);
      edges.push({
        id: `${source}->${target}:${edge.on}:${edge.priority}`,
        source,
        target,
        label: edge.on,
        data: { qualifiedSource: source, qualifiedTarget: target },
      });
    }
  }
  return { nodes, edges };
}

export function updateLayout(
  layout: LayoutSidecar,
  positions: Record<string, { x: number; y: number }>,
): LayoutSidecar {
  const nextPositions = { ...layout.positions };
  for (const [id, position] of Object.entries(positions)) {
    if (id in nextPositions && Number.isFinite(position.x) && Number.isFinite(position.y)) {
      nextPositions[id] = { x: position.x, y: position.y };
    }
  }
  return LayoutSidecarSchema.parse({ ...layout, positions: nextPositions });
}

export function layoutIsValid(document: SemanticDocument, layout: LayoutSidecar): boolean {
  const expected = new Set<string>();
  for (const graph of document.graphs) {
    for (const node of graph.nodes) {
      expected.add(qualifiedNodeId(graph.id, node.id));
    }
  }
  const actual = Object.keys(layout.positions);
  return actual.length === expected.size && actual.every((id) => expected.has(id));
}

export function layoutOnlyChange(before: SemanticDocument, after: SemanticDocument): boolean {
  return canonicalJson(before) === canonicalJson(after);
}

export function diffDocuments(before: unknown, after: unknown, path = "$", changes: DocumentChange[] = []): DocumentChange[] {
  if (before === undefined || after === undefined) {
    if (before !== after) {
      changes.push({ path, before: toJsonValueOrUndefined(before), after: toJsonValueOrUndefined(after) });
    }
    return changes;
  }
  if (canonicalJson(before) === canonicalJson(after)) {
    return changes;
  }
  if (typeof before !== "object" || before === null || typeof after !== "object" || after === null || Array.isArray(before) !== Array.isArray(after)) {
    changes.push({ path, before: toJsonValueOrUndefined(before), after: toJsonValueOrUndefined(after) });
    return changes;
  }
  if (Array.isArray(before) && Array.isArray(after)) {
    const length = Math.max(before.length, after.length);
    for (let index = 0; index < length; index += 1) {
      diffDocuments(before[index], after[index], `${path}[${index}]`, changes);
    }
    return changes;
  }
  const beforeRecord = before as Record<string, unknown>;
  const afterRecord = after as Record<string, unknown>;
  const keys = new Set([...Object.keys(beforeRecord), ...Object.keys(afterRecord)]);
  for (const key of [...keys].sort()) {
    diffDocuments(beforeRecord[key], afterRecord[key], `${path}.${key}`, changes);
  }
  return changes;
}

function toJsonValueOrUndefined(value: unknown): JsonValue | undefined {
  return value === undefined ? undefined : canonicalize(value);
}

export function updateNode(
  document: SemanticDocument,
  graphId: string,
  nodeId: string,
  update: (node: SemanticDocument["graphs"][number]["nodes"][number]) => SemanticDocument["graphs"][number]["nodes"][number],
): SemanticDocument {
  const next = cloneDocument(document);
  const graph = next.graphs.find((candidate) => candidate.id === graphId);
  if (!graph) {
    throw new Error(`graph ${graphId} does not exist`);
  }
  const index = graph.nodes.findIndex((node) => node.id === nodeId);
  if (index < 0) {
    throw new Error(`node ${nodeId} does not exist in graph ${graphId}`);
  }
  graph.nodes[index] = update(graph.nodes[index]);
  return WorkflowDefinitionSchema.parse(next);
}

export function addNode(
  document: SemanticDocument,
  graphId: string,
  node: SemanticDocument["graphs"][number]["nodes"][number],
): SemanticDocument {
  const next = cloneDocument(document);
  const graph = next.graphs.find((candidate) => candidate.id === graphId);
  if (!graph || graph.nodes.some((candidate) => candidate.id === node.id)) {
    throw new Error(`cannot add duplicate or missing node ${graphId}:${node.id}`);
  }
  graph.nodes.push(node);
  return WorkflowDefinitionSchema.parse(next);
}

export function removeNode(document: SemanticDocument, graphId: string, nodeId: string): SemanticDocument {
  const next = cloneDocument(document);
  const graph = next.graphs.find((candidate) => candidate.id === graphId);
  if (!graph) {
    throw new Error(`graph ${graphId} does not exist`);
  }
  if (graph.entry_node === nodeId) {
    throw new Error("the graph entry node cannot be removed");
  }
  graph.nodes = graph.nodes.filter((node) => node.id !== nodeId);
  graph.edges = graph.edges.filter((edge) => edge.from !== nodeId && edge.to !== nodeId);
  return WorkflowDefinitionSchema.parse(next);
}

export function addEdge(
  document: SemanticDocument,
  graphId: string,
  edge: SemanticDocument["graphs"][number]["edges"][number],
): SemanticDocument {
  const next = cloneDocument(document);
  const graph = next.graphs.find((candidate) => candidate.id === graphId);
  if (!graph || !graph.nodes.some((node) => node.id === edge.from) || !graph.nodes.some((node) => node.id === edge.to)) {
    throw new Error("edges must connect nodes in the same graph");
  }
  if (graph.edges.some((candidate) => candidate.from === edge.from && candidate.to === edge.to && candidate.on === edge.on)) {
    return next;
  }
  graph.edges.push(edge);
  return WorkflowDefinitionSchema.parse(next);
}

export function reconnectEdge(
  document: SemanticDocument,
  graphId: string,
  edgeIndex: number,
  from: string,
  to: string,
): SemanticDocument {
  const next = cloneDocument(document);
  const graph = next.graphs.find((candidate) => candidate.id === graphId);
  if (!graph || !graph.nodes.some((node) => node.id === from) || !graph.nodes.some((node) => node.id === to)) {
    throw new Error("reconnected edges must target nodes in the same graph");
  }
  const edge = graph.edges[edgeIndex];
  if (!edge) {
    throw new Error(`edge ${edgeIndex} does not exist in graph ${graphId}`);
  }
  if (graph.edges.some((candidate, index) => index !== edgeIndex && candidate.from === from && candidate.to === to && candidate.on === edge.on)) {
    throw new Error("reconnection would create a duplicate guarded edge");
  }
  graph.edges[edgeIndex] = { ...edge, from, to };
  return WorkflowDefinitionSchema.parse(next);
}

export function copyNodes(document: SemanticDocument, qualifiedIds: string[]): NodeClipboard {
  if (qualifiedIds.length === 0) {
    throw new Error("select at least one node before copying");
  }
  const parsed = qualifiedIds.map(parseQualifiedId);
  const graphIds = new Set(parsed.map((value) => value.graphId));
  if (graphIds.size !== 1) {
    throw new Error("copy a single graph selection at a time");
  }
  const sourceGraphId = parsed[0].graphId;
  const graph = document.graphs.find((candidate) => candidate.id === sourceGraphId);
  if (!graph) {
    throw new Error(`graph ${sourceGraphId} does not exist`);
  }
  const ids = new Set(parsed.map((value) => value.nodeId));
  const nodes = graph.nodes.filter((node) => ids.has(node.id)).map((node) => cloneJson(node));
  if (nodes.length !== parsed.length) {
    throw new Error("copy selection contains an unknown node");
  }
  const edges = graph.edges.filter((edge) => ids.has(edge.from) && ids.has(edge.to)).map((edge) => cloneJson(edge));
  return { sourceGraphId, nodes, edges };
}

export function pasteNodes(
  document: SemanticDocument,
  graphId: string,
  clipboard: NodeClipboard,
  offset = { x: 32, y: 32 },
): PasteResult {
  const next = cloneDocument(document);
  const graph = next.graphs.find((candidate) => candidate.id === graphId);
  if (!graph) {
    throw new Error(`graph ${graphId} does not exist`);
  }
  if (graph.nodes.length + clipboard.nodes.length > 512) {
    throw new Error("pasting these nodes would exceed the graph node bound");
  }
  const existing = new Set(graph.nodes.map((node) => node.id));
  const idMap: Record<string, string> = {};
  for (const node of clipboard.nodes) {
    const base = `${node.id}_copy`;
    let candidate = base;
    let suffix = 2;
    while (existing.has(candidate)) {
      candidate = `${base}_${suffix}`;
      suffix += 1;
    }
    existing.add(candidate);
    idMap[node.id] = candidate;
  }
  if (graph.edges.length + clipboard.edges.length > 2048) {
    throw new Error("pasting these nodes would exceed the graph edge bound");
  }
  for (const node of clipboard.nodes) {
    const remapped = remapLocalReferences(node.config, idMap, clipboard.sourceGraphId, graphId);
    graph.nodes.push({ ...cloneJson(node), id: idMap[node.id], config: remapped });
  }
  for (const edge of clipboard.edges) {
    const from = idMap[edge.from];
    const to = idMap[edge.to];
    if (!from || !to) continue;
    graph.edges.push({ ...cloneJson(edge), from, to });
  }
  return {
    document: WorkflowDefinitionSchema.parse(next),
    selectedIds: clipboard.nodes.map((node) => qualifiedNodeId(graphId, idMap[node.id])),
    idMap,
  };
}

export function alignLayout(
  layout: LayoutSidecar,
  qualifiedIds: string[],
  axis: "x" | "y" | "both",
): LayoutSidecar {
  if (qualifiedIds.length < 2) return LayoutSidecarSchema.parse(layout);
  const positions = qualifiedIds.map((id) => layout.positions[id]).filter((position): position is { x: number; y: number } => position !== undefined);
  if (positions.length !== qualifiedIds.length) {
    throw new Error("alignment selection contains an unknown layout node");
  }
  const anchor = positions[0];
  const next = { ...layout.positions };
  for (const id of qualifiedIds) {
    const position = next[id];
    if (!position) continue;
    next[id] = {
      x: axis === "y" ? position.x : anchor.x,
      y: axis === "x" ? position.y : anchor.y,
    };
  }
  return LayoutSidecarSchema.parse({ ...layout, positions: next });
}

export function mergeDocuments(
  base: SemanticDocument,
  local: SemanticDocument,
  remote: SemanticDocument,
): DocumentMergeResult {
  const conflicts: MergeConflict[] = [];
  const merged = mergeJson(base, local, remote, "$", conflicts);
  if (conflicts.length > 0) {
    return { document: undefined, conflicts, changedPaths: conflicts.map((conflict) => conflict.path) };
  }
  const parsed = WorkflowDefinitionSchema.safeParse(merged);
  if (!parsed.success) {
    return {
      document: undefined,
      conflicts: [{ path: "$", base: cloneJson(base), local: cloneJson(local), remote: cloneJson(remote) }],
      changedPaths: ["$"],
    };
  }
  return { document: parsed.data, conflicts: [], changedPaths: diffDocuments(base, parsed.data).map((change) => change.path) };
}

export function mergeLayoutSidecars(
  base: LayoutSidecar,
  local: LayoutSidecar,
  remote: LayoutSidecar,
): LayoutMergeResult {
  const conflicts: MergeConflict[] = [];
  const merged = mergeJson(base, local, remote, "$", conflicts);
  if (conflicts.length > 0) return { layout: undefined, conflicts };
  const parsed = LayoutSidecarSchema.safeParse(merged);
  return parsed.success ? { layout: parsed.data, conflicts: [] } : {
    layout: undefined,
    conflicts: [{ path: "$", base: cloneJson(base), local: cloneJson(local), remote: cloneJson(remote) }],
  };
}

function parseQualifiedId(value: string): { graphId: string; nodeId: string } {
  const separator = value.indexOf(":");
  if (separator <= 0 || separator === value.length - 1) {
    throw new Error(`invalid qualified node ID: ${value}`);
  }
  return { graphId: value.slice(0, separator), nodeId: value.slice(separator + 1) };
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function remapLocalReferences(value: JsonObject, idMap: Record<string, string>, sourceGraphId: string, targetGraphId: string): JsonObject {
  const remap = (current: JsonValue): JsonValue => {
    if (typeof current === "string") {
      if (idMap[current]) return idMap[current];
      const qualifiedPrefix = `${sourceGraphId}:`;
      if (current.startsWith(qualifiedPrefix) && idMap[current.slice(qualifiedPrefix.length)]) {
        return `${targetGraphId}:${idMap[current.slice(qualifiedPrefix.length)]}`;
      }
      return current;
    }
    if (Array.isArray(current)) return current.map(remap);
    if (current !== null && typeof current === "object") {
      const output = Object.create(null) as JsonObject;
      for (const [key, child] of Object.entries(current)) output[key] = remap(child);
      return output;
    }
    return current;
  };
  return remap(value) as JsonObject;
}

function mergeJson(
  base: unknown,
  local: unknown,
  remote: unknown,
  path: string,
  conflicts: MergeConflict[],
): JsonValue | undefined {
  if (sameJson(local, base)) return toJsonValueOrUndefined(remote);
  if (sameJson(remote, base) || sameJson(local, remote)) return toJsonValueOrUndefined(local);
  if (isJsonRecord(base) && isJsonRecord(local) && isJsonRecord(remote)) {
    const output = Object.create(null) as JsonObject;
    const keys = new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)]);
    for (const key of [...keys].sort()) {
      const value = mergeJson(base[key], local[key], remote[key], `${path}.${key}`, conflicts);
      if (value !== undefined) output[key] = value;
    }
    return output;
  }
  if (Array.isArray(base) && Array.isArray(local) && Array.isArray(remote)) {
    conflicts.push({ path, base: toJsonValueOrUndefined(base), local: toJsonValueOrUndefined(local), remote: toJsonValueOrUndefined(remote) });
    return undefined;
  }
  conflicts.push({ path, base: toJsonValueOrUndefined(base), local: toJsonValueOrUndefined(local), remote: toJsonValueOrUndefined(remote) });
  return undefined;
}

function sameJson(first: unknown, second: unknown): boolean {
  if (first === undefined || second === undefined) return first === second;
  return canonicalJson(first) === canonicalJson(second);
}

export class History<T> {
  private readonly past: T[] = [];
  private readonly future: T[] = [];

  public constructor(private current: T, private readonly copy: (value: T) => T, private readonly maxEntries = 128) {}

  public present(): T {
    return this.copy(this.current);
  }

  public commit(next: T): T {
    this.past.push(this.copy(this.current));
    if (this.past.length > this.maxEntries) this.past.shift();
    this.current = this.copy(next);
    this.future.length = 0;
    return this.present();
  }

  public undo(): T {
    const previous = this.past.pop();
    if (previous === undefined) {
      return this.present();
    }
    this.future.push(this.copy(this.current));
    this.current = this.copy(previous);
    return this.present();
  }

  public redo(): T {
    const next = this.future.pop();
    if (next === undefined) {
      return this.present();
    }
    this.past.push(this.copy(this.current));
    this.current = this.copy(next);
    return this.present();
  }

  public canUndo(): boolean {
    return this.past.length > 0;
  }

  public canRedo(): boolean {
    return this.future.length > 0;
  }
}
