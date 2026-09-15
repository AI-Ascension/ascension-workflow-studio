import { StatusBadge } from "../../components/StatusBadge";
import type { ContextCatalogState } from "./useContextOwnerCatalog";
import { contextBindingsFromOwnerCatalog } from "@studio/contracts";

export function ContextOwnerCatalogPanel({ state, refresh }: {
  state: ContextCatalogState; refresh: () => void;
}): JSX.Element {
  const catalog = state.status === "available" ? state.catalog : undefined;
  return <section className="panel-card" aria-label="Context reference catalog">
    <div className="panel-title">
      <div><p className="eyebrow">Authoring context references</p><h2>Owner binding catalog</h2></div>
      <StatusBadge tone={catalog ? "success" : "muted"}>{state.status}</StatusBadge>
    </div>
    <button className="button button-secondary" onClick={refresh}>Refresh context catalog</button>
    {state.status === "pending" ? <p role="status">Loading owner catalog. Previous bindings are unavailable.</p> : null}
    {state.status === "unavailable" ? <p role="status">{state.reason}</p> : null}
    {catalog ? <div data-testid="owner-context-catalog">
      <p className="muted">Owner {catalog.owner_id} · {catalog.owner_version}</p>
      {contextBindingsFromOwnerCatalog(catalog)?.length === 0 ? <p>No compatible references were disclosed.</p> : null}
      {catalog.descriptors.map((descriptor) => <section key={`${descriptor.binding_id}:${descriptor.version}`}
        aria-label={`Context descriptor ${descriptor.context_ref}`}>
        <h3>{descriptor.context_ref}</h3>
        <p>{descriptor.binding_id} · version {descriptor.version} · {descriptor.state} · {descriptor.grants.content_read ? "content scope" : "metadata-only"}</p>
        <p>Node kinds: {descriptor.node_kinds.join(", ")}</p>
        <p>Reference limits supplied by the owner</p>
        <dl>
          <dt>Items</dt><dd>{descriptor.effective_limits.max_items}</dd>
          <dt>Notes</dt><dd>{descriptor.effective_limits.max_notes}</dd>
          <dt>Context bytes per input/schema/configuration buffer</dt><dd>{descriptor.effective_limits.max_context_bytes}</dd>
          <dt>Objective bytes</dt><dd>{descriptor.effective_limits.max_objective_bytes}</dd>
          <dt>Recorded events</dt><dd>{descriptor.effective_limits.max_control_events}</dd>
        </dl>
      </section>)}
      <p className="muted">These limits are reference information; runtime enforcement must be confirmed by the workflow owner. Disabled, stale and other unavailable references cannot be selected.</p>
    </div> : null}
  </section>;
}
