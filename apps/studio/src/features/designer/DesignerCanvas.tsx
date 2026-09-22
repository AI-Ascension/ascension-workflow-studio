import { type MouseEvent as ReactMouseEvent } from "react";

import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  type Connection,
  type Edge,
  type NodeChange,
} from "@xyflow/react";

import { BACKGROUND_PROPS, FIT_VIEW_OPTIONS, PRO_OPTIONS, type FlowNode } from "./graphProjection";

export type CanvasEdge = Edge<{ qualifiedSource: string; qualifiedTarget: string }>;

export interface DesignerCanvasProps {
  activeGraphId: string;
  nodes: FlowNode[];
  edges: CanvasEdge[];
  viewport: { x: number; y: number; zoom: number } | undefined;
  onMoveEnd: (event: unknown, viewport: { x: number; y: number; zoom: number }) => void;
  onNodesChange: (changes: NodeChange<FlowNode>[]) => void;
  onConnect: (connection: Connection) => void;
  onNodeClick: (event: ReactMouseEvent, node: FlowNode) => void;
  onEdgeClick: (event: ReactMouseEvent, edge: Edge) => void;
  onNodeDragStop: (event: MouseEvent | TouchEvent, node: FlowNode) => void;
  minimapNodeColor: (node: FlowNode) => string;
}

/**
 * Canvas composition for one active graph. Owns only the React Flow surface and
 * its presentation constants; graph state, viewports and handlers stay with the
 * DesignerView controller so canvas/list parity is unchanged.
 */
export function DesignerCanvas({ activeGraphId, nodes, edges, viewport, onMoveEnd, onNodesChange, onConnect, onNodeClick, onEdgeClick, onNodeDragStop, minimapNodeColor }: DesignerCanvasProps): JSX.Element {
  return <div className="flow-shell" aria-label="Workflow graph canvas">
    <ReactFlow<FlowNode, CanvasEdge>
      key={activeGraphId}
      nodes={nodes}
      edges={edges}
      defaultViewport={viewport ?? { x: 0, y: 0, zoom: 1 }}
      onMoveEnd={onMoveEnd}
      onNodesChange={onNodesChange}
      onConnect={onConnect}
      onNodeClick={onNodeClick}
      onEdgeClick={onEdgeClick}
      onNodeDragStop={onNodeDragStop}
      fitView={viewport === undefined}
      fitViewOptions={FIT_VIEW_OPTIONS}
      nodesDraggable
      nodesConnectable
      deleteKeyCode={null}
      proOptions={PRO_OPTIONS}
    >
      <Background {...BACKGROUND_PROPS} />
      <Controls showInteractive={false} />
      <MiniMap pannable zoomable nodeColor={minimapNodeColor} />
    </ReactFlow>
  </div>;
}
