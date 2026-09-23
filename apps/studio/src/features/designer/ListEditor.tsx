import { type ReactNode } from "react";

import { type WorkflowNode } from "@studio/contracts";
import { type SemanticDocument } from "@studio/document";

import { StatusBadge } from "../../components/StatusBadge";

export interface ListEditorProps {
  document: SemanticDocument;
  selectedIds: string[];
  onSelect: (id: string, additive?: boolean) => void;
  inspector: ReactNode;
}

export function ListEditor({ document, selectedIds, onSelect, inspector }: ListEditorProps): JSX.Element {
  return <div className="list-editor">
    <div className="list-editor-main">
      <div className="panel-title"><div><p className="eyebrow">Equivalent editor</p><h2>Semantic node list</h2></div><span className="muted">Keyboard friendly</span></div>
      {document.graphs.map((graph) => <div className="graph-list" key={graph.id}>
        <div className="graph-list-title"><span>{graph.id}</span><span className="muted">entry: {graph.entry_node}</span></div>
        {graph.nodes.map((node) => {
          const id = `${graph.id}:${node.id}`;
          return <button className={`node-list-row ${selectedIds.includes(id) ? "selected" : ""}`} key={id} onClick={(event) => onSelect(id, event.metaKey || event.ctrlKey)} aria-pressed={selectedIds.includes(id)}>
            <span className="node-kind-icon" aria-hidden="true">{node.kind === "adaptive_region" ? "◇" : "•"}</span>
            <span><strong>{node.id}</strong><small>{node.kind}</small></span>
            {node.kind === "adaptive_region" ? <StatusBadge tone="warning">protected</StatusBadge> : null}
          </button>;
        })}
      </div>)}
    </div>
    {inspector}
  </div>;
}
