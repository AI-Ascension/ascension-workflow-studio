import { type JsonObject, type WorkflowNode } from "@studio/contracts";

import type { SemanticDocument } from "./semantic-document";

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
