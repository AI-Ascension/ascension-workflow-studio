import { type LayoutSidecar, LayoutSidecarSchema } from "@studio/contracts";

import { canonicalJson } from "./json";
import type { SemanticDocument } from "./semantic-document";

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
