import { type WorkflowNode } from "@studio/contracts";
import { type SemanticDocument } from "@studio/document";

export function GraphNavigator({ document, activeGraphId, trail, onFocus, onSelectTrail }: { document: SemanticDocument; activeGraphId: string; trail: string[]; onFocus: (graphId: string) => void; onSelectTrail: (index: number) => void }): JSX.Element {
  return <nav className="graph-nav panel-card" aria-label="Workflow graph navigation">
    <div className="graph-nav-row">
      <span className="eyebrow">Breadcrumbs</span>
      <ol className="graph-breadcrumbs" aria-label="Graph breadcrumb trail">
        {trail.map((graphId, index) => <li key={`${graphId}-${index}`}>{index > 0 ? <span className="graph-crumb-separator" aria-hidden="true">›</span> : null}{index === trail.length - 1 ? <span className="graph-crumb-current" aria-current="page">{graphId}</span> : <button className="graph-crumb" onClick={() => onSelectTrail(index)}>{graphId}</button>}</li>)}
      </ol>
    </div>
    <div className="graph-nav-row">
      <span className="eyebrow">Graphs</span>
      <div className="graph-switcher" role="group" aria-label="All workflow graphs">
        {document.graphs.map((graph) => <button key={graph.id} className={`button ${graph.id === activeGraphId ? "button-secondary" : "button-quiet"}`} aria-pressed={graph.id === activeGraphId} onClick={() => onFocus(graph.id)}>{graph.id}</button>)}
      </div>
    </div>
    <p className="graph-nav-note">Graphs are navigated one at a time; this list is not execution ordering or parallelism.</p>
  </nav>;
}

export function LoopBodyGraphNavigation({ document, node, onNavigateGraph }: { document: SemanticDocument; node: WorkflowNode; onNavigateGraph: (graphId: string) => void }): JSX.Element | null {
  const bodyGraph = node.config.body_graph;
  if (typeof bodyGraph !== "string" || !document.graphs.some((graph) => graph.id === bodyGraph)) return null;
  return <div className="nested-graph-action"><span className="muted">Bounded loop body</span><button className="button button-secondary" onClick={() => onNavigateGraph(bodyGraph)}>Open body graph: {bodyGraph}</button></div>;
}
