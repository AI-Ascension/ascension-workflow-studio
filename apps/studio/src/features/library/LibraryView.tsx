import { useMemo, useState } from "react";

import type { DefinitionRecord } from "@studio/contracts";

import { EmptyState } from "../../components/EmptyState";
import { StatusBadge } from "../../components/StatusBadge";

interface LibraryViewProps {
  definitions: DefinitionRecord[];
  loading: boolean;
  catalogNotice: string | undefined;
  onOpen: (definition: DefinitionRecord) => void;
  onCreate: (template?: DefinitionRecord) => void;
  onRefresh: () => void;
}

export function LibraryView({ definitions, loading, catalogNotice, onOpen, onCreate, onRefresh }: LibraryViewProps): JSX.Element {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return definitions;
    return definitions.filter((definition) => `${definition.title} ${definition.id} ${definition.description}`.toLowerCase().includes(normalized));
  }, [definitions, query]);

  return <section className="view-stack" aria-labelledby="library-title">
    <div className="view-heading">
      <div>
        <p className="eyebrow">Workspace / Library</p>
        <h1 id="library-title">Workflow library</h1>
        <p className="lede">Admitted workflow definitions and durable editing entry points.</p>
      </div>
      <button className="button button-primary" onClick={() => onCreate()}>＋ New draft</button>
    </div>
    {catalogNotice ? <div className="notice notice-warning"><strong>Catalog source</strong><span>{catalogNotice}</span></div> : null}
    <div className="toolbar-row">
      <label className="search-field">
        <span className="sr-only">Filter workflows</span>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter by name or ID" />
        <span aria-hidden="true">⌕</span>
      </label>
      <button className="button button-quiet" onClick={onRefresh} disabled={loading}>Refresh library</button>
      <span className="toolbar-meta">{filtered.length} definition{filtered.length === 1 ? "" : "s"}</span>
    </div>
    {loading ? <div className="loading-line">Loading admitted catalog…</div> : null}
    {!loading && filtered.length === 0 ? <EmptyState title="No matching definitions" detail="Change the filter or create a draft from the admitted contract." action={{ label: "Create draft", onClick: () => onCreate() }} /> : null}
    <div className="library-grid">
      {filtered.map((definition) => <article className="definition-card" key={definition.id} data-capabilities={definition.capabilities.join(" ")}>
        <div className="card-topline">
          <StatusBadge tone={definition.source === "catalog" ? "success" : "warning"}>{definition.source}</StatusBadge>
          <span className="card-id">{definition.id}</span>
        </div>
        <h2>{definition.title}</h2>
        <p>{definition.description}</p>
        <div className="capability-list" aria-label="Required capabilities">
          {definition.capabilities.slice(0, 3).map((capability) => <span className="capability-chip" key={capability}>{capability}</span>)}
          {definition.capabilities.length > 3 ? <span className="capability-chip">+{definition.capabilities.length - 3}</span> : null}
        </div>
        <div className="card-footer">
          <span className="muted">Updated {new Date(definition.updatedAt).toLocaleDateString()}</span>
          <div className="card-actions"><button className="button button-quiet" onClick={() => onCreate(definition)}>Clone draft</button><button className="button button-secondary" onClick={() => onOpen(definition)}>Open designer</button></div>
        </div>
      </article>)}
    </div>
  </section>;
}
