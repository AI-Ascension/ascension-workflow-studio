import {
  type JsonObject,
  type JsonValue,
  type WorkflowEdge,
  WorkflowEdgeSchema,
  type WorkflowNode,
  WorkflowDefinitionSchema,
  WorkflowNodeSchema,
} from "@studio/contracts";

import { canonicalJson, cloneJson, toJsonValueOrUndefined } from "./json";
import { qualifiedNodeId } from "./layout";
import type { SemanticDocument } from "./semantic-document";

export interface DocumentChange {
  path: string;
  before: JsonValue | undefined;
  after: JsonValue | undefined;
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

export const MAX_CLIPBOARD_NODES = 128;
export const MAX_CLIPBOARD_EDGES = 512;
export const MAX_CLIPBOARD_BYTES = 256 * 1024;

export function cloneDocument(document: SemanticDocument): SemanticDocument {
  return WorkflowDefinitionSchema.parse(JSON.parse(JSON.stringify(document)) as unknown);
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

export function updateNode(
  document: SemanticDocument,
  graphId: string,
  nodeId: string,
  update: (node: SemanticDocument["graphs"][number]["nodes"][number]) => SemanticDocument["graphs"][number]["nodes"][number],
): SemanticDocument {
  // Structural copy instead of a full JSON deep clone: `WorkflowDefinitionSchema.parse`
  // already returns a freshly built, validated document, so the extra deep clone
  // only doubled the per-edit cost on admitted-size graphs (P2-089).
  const graphIndex = document.graphs.findIndex((candidate) => candidate.id === graphId);
  if (graphIndex < 0) {
    throw new Error(`graph ${graphId} does not exist`);
  }
  const graph = document.graphs[graphIndex];
  const index = graph.nodes.findIndex((node) => node.id === nodeId);
  if (index < 0) {
    throw new Error(`node ${nodeId} does not exist in graph ${graphId}`);
  }
  const updated = update(graph.nodes[index]);
  if (updated.id !== nodeId) {
    throw new Error(`updateNode cannot change the node id ${nodeId}`);
  }
  // Node fields are independent, so validating the single edited node preserves
  // the document invariant without rebuilding and re-parsing the whole graph on
  // every keystroke (P2-089).
  const nextNodes = [...graph.nodes];
  nextNodes[index] = WorkflowNodeSchema.parse(updated);
  const nextGraphs = [...document.graphs];
  nextGraphs[graphIndex] = { ...graph, nodes: nextNodes };
  return { ...document, graphs: nextGraphs };
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
  // The owner orders control edges by `(from, on, priority, target)` and
  // rejects a priority tie for the same source/outcome. Guard references do
  // not make a tied route distinct, while different priorities are valid
  // ordered fallbacks. Preserve idempotency for an exact edge re-add.
  const priorityTie = graph.edges.find((candidate) => candidate.from === edge.from && candidate.on === edge.on && candidate.priority === edge.priority);
  if (priorityTie) {
    if (priorityTie.to === edge.to && priorityTie.guard_ref === edge.guard_ref) return next;
    throw new Error("edge would create an owner priority tie");
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
  if (graph.edges.some((candidate, index) => index !== edgeIndex && candidate.from === from && candidate.on === edge.on && candidate.priority === edge.priority)) {
    throw new Error("reconnection would create an owner priority tie");
  }
  graph.edges[edgeIndex] = { ...edge, from, to };
  return WorkflowDefinitionSchema.parse(next);
}

/** Update an edge's owner-visible outcome, priority, or guard reference. */
export function updateEdge(
  document: SemanticDocument,
  graphId: string,
  edgeIndex: number,
  update: (edge: WorkflowEdge) => WorkflowEdge,
): SemanticDocument {
  const next = cloneDocument(document);
  const graph = next.graphs.find((candidate) => candidate.id === graphId);
  if (!graph) throw new Error(`graph ${graphId} does not exist`);
  const edge = graph.edges[edgeIndex];
  if (!edge) throw new Error(`edge ${edgeIndex} does not exist in graph ${graphId}`);
  const updated = WorkflowEdgeSchema.parse(update(edge));
  if (!graph.nodes.some((node) => node.id === updated.from) || !graph.nodes.some((node) => node.id === updated.to)) {
    throw new Error("edges must connect nodes in the same graph");
  }
  if (graph.edges.some((candidate, index) => index !== edgeIndex && candidate.from === updated.from && candidate.on === updated.on && candidate.priority === updated.priority)) {
    throw new Error("edge update would create an owner priority tie");
  }
  graph.edges[edgeIndex] = updated;
  return WorkflowDefinitionSchema.parse(next);
}

export function copyNodes(document: SemanticDocument, qualifiedIds: string[]): NodeClipboard {
  if (qualifiedIds.length === 0) {
    throw new Error("select at least one node before copying");
  }
  if (qualifiedIds.length > MAX_CLIPBOARD_NODES) {
    throw new Error(`copy selection exceeds the ${MAX_CLIPBOARD_NODES}-node clipboard bound`);
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
  if (edges.length > MAX_CLIPBOARD_EDGES) {
    throw new Error(`copy selection exceeds the ${MAX_CLIPBOARD_EDGES}-edge clipboard bound`);
  }
  const clipboard = { sourceGraphId, nodes, edges };
  if (new TextEncoder().encode(JSON.stringify(clipboard)).byteLength > MAX_CLIPBOARD_BYTES) {
    throw new Error(`copy selection exceeds the ${MAX_CLIPBOARD_BYTES / 1024} KiB clipboard bound`);
  }
  return clipboard;
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

function parseQualifiedId(value: string): { graphId: string; nodeId: string } {
  const separator = value.indexOf(":");
  if (separator <= 0 || separator === value.length - 1) {
    throw new Error(`invalid qualified node ID: ${value}`);
  }
  return { graphId: value.slice(0, separator), nodeId: value.slice(separator + 1) };
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
