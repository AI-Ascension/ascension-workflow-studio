import { type WorkflowNode } from "@studio/contracts";
import { qualifiedNodeId, type SemanticDocument } from "@studio/document";

import { type FlowNode } from "./graphProjection";

export interface SelectedNode {
  graphId: string;
  node: WorkflowNode;
}

export function findSelectedNode(document: SemanticDocument, selectedId: string | undefined): SelectedNode | undefined {
  if (!selectedId) return undefined;
  const split = splitQualifiedId(selectedId);
  if (!split) return undefined;
  const graph = document.graphs.find((candidate) => candidate.id === split.graphId);
  const node = graph?.nodes.find((candidate) => candidate.id === split.nodeId);
  return graph && node ? { graphId: graph.id, node } : undefined;
}

export function locateEdge(document: SemanticDocument, edgeId: string): { graphId: string; edgeIndex: number } | undefined {
  for (const graph of document.graphs) {
    for (const [edgeIndex, edge] of graph.edges.entries()) {
      const source = qualifiedNodeId(graph.id, edge.from);
      const target = qualifiedNodeId(graph.id, edge.to);
      if (`${source}->${target}:${edge.on}:${edge.priority}:${edge.guard_ref ?? ""}` === edgeId) return { graphId: graph.id, edgeIndex };
    }
  }
  return undefined;
}

export function splitQualifiedId(value: string): { graphId: string; nodeId: string } | undefined {
  const separator = value.indexOf(":");
  if (separator <= 0 || separator === value.length - 1) return undefined;
  return { graphId: value.slice(0, separator), nodeId: value.slice(separator + 1) };
}

export function nextNodeId(ids: string[]): string {
  let index = 1;
  while (ids.includes(`studio_node_${index}`)) index += 1;
  return `studio_node_${index}`;
}

/** Stable minimap coloring: locked/protected nodes never share the editable hue. */
export function minimapNodeColor(node: FlowNode): string {
  return node.data.locked ? "#f0a45b" : "#5da8ff";
}
