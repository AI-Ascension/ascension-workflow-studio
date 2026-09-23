import { useState } from "react";

import { type LayoutSidecar } from "@studio/contracts";
import { diffDocuments, mergeDocuments, mergeLayoutSidecars, type SemanticDocument } from "@studio/document";

import { StatusBadge } from "../../components/StatusBadge";

export interface ConflictPanelProps {
  base: SemanticDocument;
  baseLayout: LayoutSidecar;
  local: SemanticDocument;
  localLayout: LayoutSidecar;
  remote: SemanticDocument;
  remoteLayout: LayoutSidecar;
  onKeepRemote: () => void;
  onKeepLocal: () => Promise<void>;
  onMerge: () => Promise<void>;
  onCancel: () => void;
}

/**
 * Three-way divergence review for a draft whose owner revision moved. Local
 * content is never discarded without an explicit, armed confirmation.
 */
export function ConflictPanel({ base, baseLayout, local, localLayout, remote, remoteLayout, onKeepRemote, onKeepLocal, onMerge, onCancel }: ConflictPanelProps): JSX.Element {
  const [reloadArmed, setReloadArmed] = useState(false);
  const localPaths = diffDocuments(base, local).map((change) => change.path);
  const remotePaths = diffDocuments(base, remote).map((change) => change.path);
  const layoutLocalPaths = diffDocuments(baseLayout, localLayout).map((change) => change.path);
  const layoutRemotePaths = diffDocuments(baseLayout, remoteLayout).map((change) => change.path);
  const merge = mergeDocuments(base, local, remote);
  const layoutMerge = mergeLayoutSidecars({ ...baseLayout, semanticDigest: "merge" }, { ...localLayout, semanticDigest: "merge" }, { ...remoteLayout, semanticDigest: "merge" });
  return <section className="conflict-panel panel-card" aria-labelledby="conflict-title">
    <div className="panel-title"><div><p className="eyebrow">Three-way review</p><h2 id="conflict-title">Local and remote drafts diverged</h2></div><StatusBadge tone={merge.conflicts.length ? "danger" : "success"}>{merge.conflicts.length ? `${merge.conflicts.length} conflicts` : "mergeable"}</StatusBadge></div>
    <p className="muted">The loaded base, local edits, and owner revision stay visible until an explicit resolution. Local content is never discarded without a protected confirmation.</p>
    <div className="conflict-columns"><div><strong>Local paths</strong><code>{localPaths.slice(0, 8).join("\n") || "none"}</code></div><div><strong>Remote paths</strong><code>{remotePaths.slice(0, 8).join("\n") || "none"}</code></div></div>
    <div className="conflict-columns"><div><strong>Local layout paths</strong><code>{layoutLocalPaths.slice(0, 8).join("\n") || "none"}</code></div><div><strong>Remote layout paths</strong><code>{layoutRemotePaths.slice(0, 8).join("\n") || "none"}</code></div></div>
    <p className="muted">Semantic {merge.conflicts.length ? "conflicts require review" : "changes merge cleanly"}; layout {layoutMerge.conflicts.length ? "movement also conflicts and local layout is kept" : "movement merges independently"}.</p>
    <div className="control-grid">
      <button className="button button-secondary" onClick={() => void onMerge()} disabled={merge.conflicts.length > 0}>Apply non-overlapping merge</button>
      <button className="button button-quiet" onClick={() => void onKeepLocal()}>Save local as new draft</button>
      {reloadArmed ? <><button className="button button-danger-outline" onClick={onKeepRemote}>Discard local and reload remote</button><button className="button button-quiet" onClick={() => setReloadArmed(false)}>Keep local edits</button></> : <button className="button button-danger-outline" onClick={() => setReloadArmed(true)}>Reload remote…</button>}
      <button className="button button-quiet" onClick={onCancel}>Cancel resolution</button>
    </div>
    {reloadArmed ? <p className="field-error" role="alert">Reloading replaces the local candidate with the owner revision and cannot be undone.</p> : null}
  </section>;
}
