import { StatusBadge } from "../../components/StatusBadge";
import type { InferenceProfileCatalogState } from "./useInferenceProfileCatalog";
import { findCredentialBearingProfileFields } from "@studio/contracts";

export function InferenceProfileCatalogPanel({ state, refresh }: {
  state: InferenceProfileCatalogState; refresh: () => void;
}): JSX.Element {
  const catalog = state.status === "available" ? state.catalog : undefined;
  // The published contract carries no credential, endpoint, executable or
  // prompt byte. This runs the contract's own leak guard over the catalog
  // actually on screen: if a future field ever leaked one, the panel says so
  // instead of quietly rendering it.
  const leaks = catalog ? findCredentialBearingProfileFields(catalog) : [];
  return <section className="panel-card" aria-label="Inference profile catalog">
    <div className="panel-title">
      <div><p className="eyebrow">Authoring inference references</p><h2>Owner inference profile catalog</h2></div>
      <StatusBadge tone={catalog ? "success" : "muted"}>{state.status}</StatusBadge>
    </div>
    <button className="button button-secondary" onClick={refresh}>Refresh inference profile catalog</button>
    {state.status === "pending" ? <p role="status">Loading owner profile catalog. No profile can be selected while it is unverified.</p> : null}
    {state.status === "unavailable" ? <p role="status">{state.reason}</p> : null}
    {leaks.length ? <p className="field-error" role="alert">The owner response disclosed credential-bearing fields ({leaks.join(", ")}); it is withheld from this view.</p> : null}
    {catalog ? <div data-testid="owner-inference-profile-catalog">
      <p className="muted">Owner {catalog.owner_id} · {catalog.owner_version}</p>
      {catalog.descriptors.length === 0 ? <p>No inference profiles were disclosed.</p> : null}
      {catalog.descriptors.map((descriptor) => <section
        key={`${descriptor.profile_id}:${descriptor.version}`}
        aria-label={`Inference profile ${descriptor.profile_id}`}>
        <h3>{descriptor.profile_id}</h3>
        <p>{descriptor.version} · {descriptor.state} · adapter {descriptor.adapter}</p>
        <p>Node kinds: {descriptor.node_kinds.join(", ")}</p>
        <p className="muted">Context compatibility: {descriptor.context_compatibility.length ? descriptor.context_compatibility.join(", ") : "unconstrained"}</p>
        <p className="muted">Owner grants: select {descriptor.grants.select ? "yes" : "no"} · edit {descriptor.grants.edit ? "yes" : "no"}</p>
      </section>)}
      <p className="muted">This catalog is reference information only. It publishes no credential, provider endpoint, executable or prompt byte, and it cannot widen a node's allowed operations or edit protected policy.</p>
    </div> : null}
  </section>;
}
