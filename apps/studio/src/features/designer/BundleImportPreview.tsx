import { type LayoutSidecar } from "@studio/contracts";
import { type SemanticDocument } from "@studio/document";

import { StatusBadge } from "../../components/StatusBadge";

export interface BundleImportValue {
  semantic: SemanticDocument;
  layout: LayoutSidecar;
  digest: string;
  changedPaths: string[];
  capabilities: string[];
}

export function BundleImportPreview({ value, onApply, onCancel }: { value: BundleImportValue; onApply: () => void; onCancel: () => void }): JSX.Element {
  return <section className="panel-card bundle-import-preview" aria-label="Imported bundle preview"><div className="panel-title"><div><p className="eyebrow">Digest-bound bundle preview</p><h2>{value.semantic.workflow_id}@{value.semantic.version}</h2></div><StatusBadge tone="warning">not applied</StatusBadge></div>
    <dl className="detail-list">
      <div><dt>Semantic digest</dt><dd><code>{value.digest}</code></dd></div>
      <div><dt>Changed paths</dt><dd>{value.changedPaths.length}</dd></div>
      <div><dt>Required capabilities</dt><dd>{value.capabilities.join(", ") || "none"}</dd></div>
    </dl>
    {value.changedPaths.length ? <ul className="plain-list bundle-diff-list">{value.changedPaths.slice(0, 12).map((path) => <li key={path}><code>{path}</code></li>)}</ul> : <p className="muted">No semantic differences from the current document.</p>}
    <div className="control-grid"><button className="button button-primary" onClick={onApply}>Apply imported bundle</button><button className="button button-quiet" onClick={onCancel}>Cancel import</button></div>
  </section>;
}

export function BundlePreviewDetails({ preview }: { preview: string }): JSX.Element {
  return <details className="bundle-preview"><summary>Last portable bundle preview</summary><pre>{preview}
…</pre></details>;
}
