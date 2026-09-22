import { type Edge, type Node } from "@xyflow/react";

import { type LayoutSidecar } from "@studio/contracts";
import {
  createFlowProjection,
  qualifiedNodeId,
  type SemanticDocument,
  type StudioFlowNode,
} from "@studio/document";

export type FlowData = StudioFlowNode["data"];
export type FlowNode = Node<FlowData>;

export const FIT_VIEW_OPTIONS = { padding: 0.2 } as const;
export const PRO_OPTIONS = { hideAttribution: true } as const;
export const BACKGROUND_PROPS = { color: "#29415b", gap: 24, size: 1 } as const;

export function toFlowNodes(document: SemanticDocument, layout: LayoutSidecar, selectedIds: string[] = [], previous: FlowNode[] = []): FlowNode[] {
  const previousById = new Map(previous.map((node) => [node.id, node]));
  return createFlowProjection({ semantic: document, layout }).nodes.map((node) => {
    const selected = selectedIds.includes(node.id);
    const draggable = !node.data.locked;
    const existing = previousById.get(node.id);
    // Selective rendering (P2-089): keep the object identity of every node whose
    // position and visible data are unchanged so React Flow can skip re-rendering
    // it. A single-node edit must not repaint the whole admitted graph.
    if (existing
      && existing.position.x === node.position.x && existing.position.y === node.position.y
      && existing.selected === selected && existing.draggable === draggable
      && existing.data.label === node.data.label && existing.data.kind === node.data.kind
      && existing.data.qualifiedId === node.data.qualifiedId && existing.data.locked === node.data.locked) {
      return existing;
    }
    return {
      id: node.id,
      position: node.position,
      data: node.data,
      selected,
      draggable,
      selectable: true,
      className: node.data.locked ? "protected-node" : "",
    };
  });
}

export function toFlowEdges(document: SemanticDocument): Edge<{ qualifiedSource: string; qualifiedTarget: string }>[] {
  // Edges depend only on the semantic graph, never on layout. Building them
  // directly avoids recomputing a full node layout on every render of the
  // admitted-size graph (P2-089).
  const edges: Edge<{ qualifiedSource: string; qualifiedTarget: string }>[] = [];
  for (const graph of document.graphs) {
    for (const edge of graph.edges) {
      const source = qualifiedNodeId(graph.id, edge.from);
      const target = qualifiedNodeId(graph.id, edge.to);
      edges.push({
        id: `${source}->${target}:${edge.on}:${edge.priority}:${edge.guard_ref ?? ""}`,
        source,
        target,
        label: edge.on,
        type: "smoothstep",
        data: { qualifiedSource: source, qualifiedTarget: target },
        animated: false,
      });
    }
  }
  return edges;
}
