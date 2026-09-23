import { useEffect, useState } from "react";

import { OWNER_EDGE_OUTCOMES, type SemanticDocument } from "@studio/document";

import { StatusBadge } from "../../components/StatusBadge";

export function EdgeInspector({ document, selectedEdge, onReconnect, onUpdate }: { document: SemanticDocument; selectedEdge: { graphId: string; edgeIndex: number }; onReconnect: (from: string, to: string) => void; onUpdate: (update: (edge: SemanticDocument["graphs"][number]["edges"][number]) => SemanticDocument["graphs"][number]["edges"][number]) => void }): JSX.Element {
  const graph = document.graphs.find((candidate) => candidate.id === selectedEdge.graphId);
  const edge = graph?.edges[selectedEdge.edgeIndex];
  const [from, setFrom] = useState(edge?.from ?? "");
  const [to, setTo] = useState(edge?.to ?? "");
  const [outcome, setOutcome] = useState(edge?.on ?? "ok");
  const [priority, setPriority] = useState(String(edge?.priority ?? 0));
  const [guardRef, setGuardRef] = useState(edge?.guard_ref ?? "");
  useEffect(() => { setFrom(edge?.from ?? ""); setTo(edge?.to ?? ""); setOutcome(edge?.on ?? "ok"); setPriority(String(edge?.priority ?? 0)); setGuardRef(edge?.guard_ref ?? ""); }, [edge?.from, edge?.to, edge?.on, edge?.priority, edge?.guard_ref]);
  if (!graph || !edge) return <aside className="inspector-panel"><p className="muted">The selected edge is no longer present.</p></aside>;
  const parsedPriority = Number(priority);
  return <aside className="inspector-panel edge-inspector" aria-label="Edge inspector"><div className="panel-title"><div><p className="eyebrow">Edge inspector</p><h2>{edge.on} / priority {edge.priority}</h2></div><StatusBadge tone="warning">semantic edit</StatusBadge></div>
    <label className="field-label">Source<select aria-label="Edge source" value={from} onChange={(event) => setFrom(event.target.value)}>{graph.nodes.map((node) => <option key={node.id} value={node.id}>{node.id}</option>)}</select></label>
    <label className="field-label">Target<select aria-label="Edge target" value={to} onChange={(event) => setTo(event.target.value)}>{graph.nodes.map((node) => <option key={node.id} value={node.id}>{node.id}</option>)}</select></label>
    <label className="field-label">Outcome<select aria-label="Edge outcome" value={outcome} onChange={(event) => setOutcome(event.target.value)}>{OWNER_EDGE_OUTCOMES.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
    <label className="field-label">Priority<input aria-label="Edge priority" type="number" min={0} max={1024} value={priority} onChange={(event) => setPriority(event.target.value)} /></label>
    <label className="field-label">Guard reference<span className="muted">optional owner guard</span><select aria-label="Edge guard reference" value={guardRef} onChange={(event) => setGuardRef(event.target.value)}><option value="">No guard</option>{(graph.guards ?? []).map((guard) => <option key={guard.id} value={guard.id}>{guard.id}</option>)}</select></label>
    <div className="control-grid"><button className="button button-secondary" onClick={() => onReconnect(from, to)}>Apply reconnection</button><button className="button button-primary" disabled={!Number.isSafeInteger(parsedPriority) || parsedPriority < 0 || parsedPriority > 1024 || !OWNER_EDGE_OUTCOMES.includes(outcome as typeof OWNER_EDGE_OUTCOMES[number])} onClick={() => onUpdate((current) => {
      const next = { ...current, from, to, on: outcome, priority: parsedPriority };
      if (guardRef) next.guard_ref = guardRef;
      else delete next.guard_ref;
      return next;
    })}>Apply edge fields</button></div>
  </aside>;
}
