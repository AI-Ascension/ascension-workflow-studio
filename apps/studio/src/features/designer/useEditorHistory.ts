import { type Dispatch, type MutableRefObject, type SetStateAction, useCallback, useRef, useState } from "react";

import { type LayoutSidecar } from "@studio/contracts";
import {
  History,
  createLayout,
  qualifiedNodeId,
  type SemanticDocument,
} from "@studio/document";

import { toFlowNodes, type FlowNode } from "./graphProjection";

export interface EditorSnapshot {
  document: SemanticDocument;
  layout: LayoutSidecar;
}

export function copyEditorSnapshot(snapshot: EditorSnapshot): EditorSnapshot {
  // `structuredClone` is a faithful structural copy and avoids the repeated
  // JSON serialization plus schema re-validation that dominated edit latency on
  // admitted-size graphs (P2-089). Snapshots entering history are already
  // schema-validated by the editor's own admission paths.
  return {
    document: structuredClone(snapshot.document),
    layout: structuredClone(snapshot.layout),
  };
}

export interface EditorHistory {
  document: SemanticDocument;
  layout: LayoutSidecar;
  nodes: FlowNode[];
  setDocument: Dispatch<SetStateAction<SemanticDocument>>;
  setLayout: Dispatch<SetStateAction<LayoutSidecar>>;
  setNodes: Dispatch<SetStateAction<FlowNode[]>>;
  documentRef: MutableRefObject<SemanticDocument>;
  layoutRef: MutableRefObject<LayoutSidecar>;
  history: MutableRefObject<History<EditorSnapshot>>;
  ensureLayout: (nextDocument: SemanticDocument, currentLayout: LayoutSidecar) => LayoutSidecar;
  syncFlowNodes: (nextDocument: SemanticDocument, nextLayout: LayoutSidecar, selected?: string[]) => void;
  resetHistory: (nextDocument: SemanticDocument, nextLayout: LayoutSidecar) => void;
}

/**
 * Owns the editor's semantic document, layout sidecar and projected flow nodes,
 * plus the undo/redo snapshot stack. Callers orchestrate commit side effects
 * (raw text, validation, archival suspension) around the state transitions.
 */
export function useEditorHistory(initialDocument: SemanticDocument): EditorHistory {
  const [document, setDocument] = useState<SemanticDocument>(() => initialDocument);
  const [layout, setLayout] = useState<LayoutSidecar>(() => createLayout(initialDocument, "pending"));
  const [nodes, setNodes] = useState<FlowNode[]>(() => toFlowNodes(initialDocument, createLayout(initialDocument, "pending")));

  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const documentRef = useRef(document);
  documentRef.current = document;

  const history = useRef(new History<EditorSnapshot>(
    { document: initialDocument, layout: createLayout(initialDocument, "pending") },
    copyEditorSnapshot,
  ));
  const flowProjectionKeyRef = useRef<string>("");

  const ensureLayout = useCallback((nextDocument: SemanticDocument, currentLayout: LayoutSidecar): LayoutSidecar => {
    // Derive missing positions straight from the semantic graphs. Building the
    // full flow projection (nodes *and* edges) just to find new ids cost more
    // than the edit itself on admitted-size graphs (P2-089).
    const next: LayoutSidecar["positions"] = {};
    let changed = false;
    let index = 0;
    for (const graph of nextDocument.graphs) {
      for (const node of graph.nodes) {
        const qualified = qualifiedNodeId(graph.id, node.id);
        const position = currentLayout.positions[qualified];
        next[qualified] = position ?? { x: 92 + (index % 4) * 248, y: 96 + Math.floor(index / 4) * 168 };
        changed ||= position === undefined;
        index += 1;
      }
    }
    changed ||= Object.keys(currentLayout.positions).length !== Object.keys(next).length;
    if (!changed) return currentLayout;
    return { ...currentLayout, positions: next };
  }, []);

  const syncFlowNodes = useCallback((nextDocument: SemanticDocument, nextLayout: LayoutSidecar, selected: string[] = []): void => {
    const key = `${selected.join(",")}|${nextDocument.graphs.map((graph) => `${graph.id}:${graph.nodes.map((node) => `${node.id}.${node.kind}`).join(",")}`).join("|")}|${Object.entries(nextLayout.positions).map(([id, position]) => `${id}@${position.x},${position.y}`).join(";")}`;
    if (key === flowProjectionKeyRef.current) return;
    flowProjectionKeyRef.current = key;
    setNodes((current) => toFlowNodes(nextDocument, nextLayout, selected, current));
  }, []);

  const resetHistory = useCallback((nextDocument: SemanticDocument, nextLayout: LayoutSidecar): void => {
    history.current = new History<EditorSnapshot>({ document: nextDocument, layout: nextLayout }, copyEditorSnapshot);
  }, []);

  return { document, layout, nodes, setDocument, setLayout, setNodes, documentRef, layoutRef, history, ensureLayout, syncFlowNodes, resetHistory };
}
