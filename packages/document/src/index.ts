import {
  LayoutSidecarSchema,
  type JsonObject,
  type JsonValue,
  type LayoutSidecar,
  type WorkflowDefinition,
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
    const output: JsonObject = {};
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
  const envelope: StudioBundleEnvelope = {
    bundleVersion: "ascension.studio-bundle/v1",
    semanticDigest: digest,
    semantic: cloneDocument(bundle.semantic),
    layout: LayoutSidecarSchema.parse(bundle.layout),
  };
  return JSON.stringify(envelope, null, 2);
}

export async function parseStudioBundle(raw: string): Promise<DocumentBundle> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error("Studio bundle is not valid JSON");
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Studio bundle must be a JSON object");
  }
  const record = parsed as Record<string, unknown>;
  if (record.bundleVersion !== "ascension.studio-bundle/v1") {
    throw new Error("Studio bundle version is unsupported");
  }
  const semantic = WorkflowDefinitionSchema.parse(record.semantic);
  const layout = LayoutSidecarSchema.parse(record.layout);
  const digest = await semanticDigest(semantic);
  if (record.semanticDigest !== digest || layout.semanticDigest !== digest) {
    throw new Error("Studio bundle semantic digest does not match its content");
  }
  if (!layoutIsValid(semantic, layout)) {
    throw new Error("Studio bundle layout contains an unknown or missing node binding");
  }
  return { semantic, layout };
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

export class History<T> {
  private readonly past: T[] = [];
  private readonly future: T[] = [];

  public constructor(private current: T, private readonly copy: (value: T) => T) {}

  public present(): T {
    return this.copy(this.current);
  }

  public commit(next: T): T {
    this.past.push(this.copy(this.current));
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
