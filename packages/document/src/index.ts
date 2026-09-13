import { sha256 as nobleSha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

import {
  LayoutSidecarSchema,
  type JsonObject,
  type JsonValue,
  type LayoutSidecar,
  type WorkflowDefinition,
  type WorkflowEdge,
  WorkflowEdgeSchema,
  type WorkflowNode,
  WorkflowDefinitionSchema,
  WorkflowNodeSchema,
} from "@studio/contracts";

export * from "./guard";
export * from "./reference";
export * from "./recovery";
export * from "./links";
export * from "./mapProjection";
export * from "./generation";

export type SemanticDocument = WorkflowDefinition;

/**
 * Node kinds admitted by the pinned owner workflow contract. Keeping this list
 * beside the edit helpers makes the canvas and list editor use the same
 * bounded vocabulary instead of silently creating an owner-invalid kind.
 */
export const OWNER_NODE_KINDS = [
  "observe",
  "await_stability",
  "route",
  "analyze",
  "decide",
  "adaptive_region",
  "execute_action",
  "subworkflow",
  "loop",
  "checkpoint",
  "emit_artifact",
  "pause",
  "terminal",
] as const;

export type OwnerNodeKind = typeof OWNER_NODE_KINDS[number];

export const OWNER_EDGE_OUTCOMES = ["ok", "error", "timeout", "unavailable", "true", "false", "unknown"] as const;
export type OwnerEdgeOutcome = typeof OWNER_EDGE_OUTCOMES[number];

export interface NodeOutputDescriptor {
  nodeId: string;
  output: string;
  type: "Observation" | "Text" | "Analysis" | "DecisionProposal" | "Null" | "SubworkflowSelection" | "Unknown" | "Artifact";
}

export interface NodeBindingDiagnostic {
  graphId: string;
  nodeId: string;
  path: string;
  code: "missing_binding" | "missing_source" | "unknown_output" | "type_mismatch";
  message: string;
}

const OWNER_NODE_OUTPUTS: Record<OwnerNodeKind, readonly Omit<NodeOutputDescriptor, "nodeId">[]> = {
  observe: [{ output: "observation", type: "Observation" }],
  await_stability: [{ output: "observation", type: "Observation" }],
  route: [{ output: "route", type: "Text" }],
  analyze: [{ output: "analysis", type: "Analysis" }],
  decide: [{ output: "proposal", type: "DecisionProposal" }],
  adaptive_region: [{ output: "proposal", type: "DecisionProposal" }],
  execute_action: [{ output: "result", type: "Null" }],
  subworkflow: [{ output: "selection", type: "SubworkflowSelection" }],
  loop: [{ output: "result", type: "Unknown" }],
  checkpoint: [{ output: "result", type: "Null" }],
  emit_artifact: [{ output: "artifact", type: "Artifact" }],
  pause: [{ output: "result", type: "Null" }],
  terminal: [],
};

export function isOwnerNodeKind(kind: string): kind is OwnerNodeKind {
  return OWNER_NODE_KINDS.includes(kind as OwnerNodeKind);
}

/** Return the output ports the owner exposes for a node kind. */
export function nodeOutputs(node: Pick<WorkflowNode, "id" | "kind">): NodeOutputDescriptor[] {
  if (!isOwnerNodeKind(node.kind)) return [];
  return OWNER_NODE_OUTPUTS[node.kind].map((output) => ({ nodeId: node.id, ...output }));
}

/**
 * Return bindings that can be selected for a node input in one graph. The
 * owner validates these same output types; the optional `requiredType` keeps
 * proposal inputs from being wired to an observation or arbitrary text port.
 */
export function compatibleNodeOutputs(
  document: SemanticDocument,
  graphId: string,
  requiredType: NodeOutputDescriptor["type"] | "any" = "any",
  excludeNodeId?: string,
): NodeOutputDescriptor[] {
  const graph = document.graphs.find((candidate) => candidate.id === graphId);
  if (!graph) return [];
  return graph.nodes
    .filter((node) => node.id !== excludeNodeId)
    .flatMap((node) => nodeOutputs(node))
    .filter((output) => requiredType === "any" || output.type === requiredType);
}

/**
 * Validate the data bindings that the owner compiler resolves against the
 * current graph. This is intentionally separate from WorkflowDefinitionSchema:
 * drafts may be structurally editable before authoritative validation, while
 * binding controls and fixture validation still need the owner's typed-port
 * rules to reject stale or incompatible references.
 */
export function validateNodeBindings(document: SemanticDocument): NodeBindingDiagnostic[] {
  const diagnostics: NodeBindingDiagnostic[] = [];
  for (const graph of document.graphs) {
    for (const node of graph.nodes) {
      if (node.kind !== "execute_action" && node.kind !== "emit_artifact") continue;
      const key = node.kind === "execute_action" ? "proposal_from" : "input_from";
      const raw = node.config[key];
      const path = `$.graphs.${graph.id}.nodes.${node.id}.config.${key}`;
      if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
        diagnostics.push({
          graphId: graph.id,
          nodeId: node.id,
          path,
          code: "missing_binding",
          message: `${node.kind} requires a ${key} binding to an upstream node output.`,
        });
        continue;
      }
      const binding = raw as JsonObject;
      const sourceId = binding.node_id;
      const output = binding.output;
      if (typeof sourceId !== "string" || sourceId.length === 0) {
        diagnostics.push({
          graphId: graph.id,
          nodeId: node.id,
          path,
          code: "missing_source",
          message: "Binding source node is missing.",
        });
        continue;
      }
      const source = graph.nodes.find((candidate) => candidate.id === sourceId);
      if (!source || source.id === node.id) {
        diagnostics.push({
          graphId: graph.id,
          nodeId: node.id,
          path,
          code: "missing_source",
          message: `Binding source node ${sourceId} is missing or refers to the input node itself.`,
        });
        continue;
      }
      if (typeof output !== "string" || output.length === 0) {
        diagnostics.push({
          graphId: graph.id,
          nodeId: node.id,
          path,
          code: "unknown_output",
          message: `Node ${sourceId} does not declare a selected output.`,
        });
        continue;
      }
      const descriptor = nodeOutputs(source).find((candidate) => candidate.output === output);
      if (!descriptor) {
        diagnostics.push({
          graphId: graph.id,
          nodeId: node.id,
          path,
          code: "unknown_output",
          message: `Node ${sourceId} does not expose output ${output}.`,
        });
        continue;
      }
      if (node.kind === "execute_action" && descriptor.type !== "DecisionProposal") {
        diagnostics.push({
          graphId: graph.id,
          nodeId: node.id,
          path,
          code: "type_mismatch",
          message: `Action proposal must come from a DecisionProposal output; ${sourceId}.${output} is ${descriptor.type}.`,
        });
      }
    }
  }
  return diagnostics;
}

function defaultBinding(
  document: SemanticDocument | undefined,
  graphId: string | undefined,
  requiredType: NodeOutputDescriptor["type"] | "any",
  currentNodeId?: string,
): { node_id: string; output: string } {
  const candidate = document && graphId
    ? compatibleNodeOutputs(document, graphId, requiredType, currentNodeId)[0]
    : undefined;
  if (candidate) return { node_id: candidate.nodeId, output: candidate.output };
  return { node_id: requiredType === "DecisionProposal" ? "studio.proposal" : "studio.input", output: requiredType === "DecisionProposal" ? "proposal" : "observation" };
}

/**
 * Create a shape-correct config for every currently admitted owner kind. The
 * returned references are deliberately bounded placeholders when a graph does
 * not yet expose a compatible source; owner validation still decides whether a
 * candidate is executable.
 */
export function defaultNodeConfig(
  kind: string,
  graph?: { id: string; nodes: WorkflowNode[]; guards?: { id: string }[] },
  currentNodeId?: string,
): JsonObject {
  const document = graph ? ({ graphs: [graph] } as SemanticDocument) : undefined;
  const graphId = graph?.id;
  switch (kind) {
    case "observe": return { projection_ref: "studio.projection" };
    case "await_stability": return { deadline_ms: 1000 };
    case "route": return { selector_ref: "studio.selector" };
    case "analyze": return { operation_ref: "studio.operation", context_ref: "studio.context" };
    case "decide": return { decision_profile_ref: "studio.decision", context_ref: "studio.context" };
    case "adaptive_region": return {
      region_id: "studio.region",
      planner_profile_ref: "studio.planner",
      allowed_operations: ["studio.operation"],
      max_plan_nodes: 1,
      max_plan_edges: 0,
      max_replans: 0,
      output_type: "DecisionProposal",
    };
    case "execute_action": return { proposal_from: defaultBinding(document, graphId, "DecisionProposal", currentNodeId) };
    case "subworkflow": return { artifact_ref: { id: "studio.subworkflow", version: "0.1.0", digest: "0".repeat(64) } };
    case "loop": return { body_graph: graphId ?? "studio.body", max_iterations: 1, exit_guard_ref: graph?.guards?.[0]?.id ?? "studio.guard" };
    case "checkpoint": return { label: "studio.checkpoint" };
    case "emit_artifact": return { artifact_kind_ref: "studio.artifact", input_from: defaultBinding(document, graphId, "any", currentNodeId) };
    case "pause": return { reason_code: "studio.pause" };
    case "terminal": return { outcome: "completed" };
    default: throw new Error(`unsupported owner node kind: ${kind}`);
  }
}

/** Convert a node with an explicit, shape-correct config reset. */
export function convertNodeKind(
  node: WorkflowNode,
  kind: string,
  graph?: { id: string; nodes: WorkflowNode[]; guards?: { id: string }[] },
): WorkflowNode {
  if (!isOwnerNodeKind(kind)) throw new Error(`unsupported owner node kind: ${kind}`);
  return { id: node.id, kind, config: defaultNodeConfig(kind, graph, node.id) };
}

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

export const MAX_CLIPBOARD_NODES = 128;
export const MAX_CLIPBOARD_EDGES = 512;
export const MAX_CLIPBOARD_BYTES = 256 * 1024;

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

function unknownNodeKinds(value: JsonObject): string[] {
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
  const semanticRecord = isJsonRecord(record.semantic) ? record.semantic : undefined;
  if (semanticRecord && unknownNodeKinds(semanticRecord).length > 0) {
    throw new Error("Studio bundle contains an unsupported owner node kind");
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
        id: `${source}->${target}:${edge.on}:${edge.priority}:${edge.guard_ref ?? ""}`,
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

/**
 * Arrange every graph deterministically for a readable left-to-right flow.
 * The layout remains a sidecar: no execution semantics are changed.
 */
export function autoLayout(layout: LayoutSidecar, document: SemanticDocument): LayoutSidecar {
  const positions: LayoutSidecar["positions"] = {};
  for (const [graphIndex, graph] of document.graphs.entries()) {
    const ranks = new Map(graph.nodes.map((node) => [node.id, 0]));
    for (let pass = 0; pass < graph.nodes.length; pass += 1) {
      let changed = false;
      for (const edge of graph.edges) {
        const sourceRank = ranks.get(edge.from) ?? 0;
        const targetRank = ranks.get(edge.to) ?? 0;
        if (edge.from !== edge.to && targetRank <= sourceRank) {
          ranks.set(edge.to, sourceRank + 1);
          changed = true;
        }
      }
      if (!changed) break;
    }
    const rowsByRank = new Map<number, number>();
    for (const node of graph.nodes) {
      const rank = ranks.get(node.id) ?? 0;
      const row = rowsByRank.get(rank) ?? 0;
      rowsByRank.set(rank, row + 1);
      positions[qualifiedNodeId(graph.id, node.id)] = {
        x: 72 + rank * 264,
        y: 84 + graphIndex * 360 + row * 148,
      };
    }
  }
  return LayoutSidecarSchema.parse({ ...layout, positions });
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
  private readonly maxEntries: number;

  public constructor(private current: T, private readonly copy: (value: T) => T, maxEntries = 128) {
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) {
      throw new Error("history maxEntries must be a positive safe integer");
    }
    this.maxEntries = maxEntries;
  }

  public present(): T {
    return this.copy(this.current);
  }

  /**
   * Records the next state. Entries are retained by reference: callers must
   * treat committed values as immutable, which the editor's update helpers
   * already guarantee. Copies are produced only when a value is handed back
   * (`present`/`undo`/`redo`), so a high-frequency edit no longer pays for
   * repeated deep snapshots it never reads (P2-089).
   */
  public commit(next: T): void {
    this.past.push(this.current);
    if (this.past.length > this.maxEntries) this.past.shift();
    this.current = next;
    this.future.length = 0;
  }

  public undo(): T {
    const previous = this.past.pop();
    if (previous === undefined) {
      return this.present();
    }
    this.future.push(this.current);
    if (this.future.length > this.maxEntries) this.future.shift();
    this.current = previous;
    return this.present();
  }

  public redo(): T {
    const next = this.future.pop();
    if (next === undefined) {
      return this.present();
    }
    this.past.push(this.current);
    if (this.past.length > this.maxEntries) this.past.shift();
    this.current = next;
    return this.present();
  }

  public canUndo(): boolean {
    return this.past.length > 0;
  }

  public canRedo(): boolean {
    return this.future.length > 0;
  }
}
