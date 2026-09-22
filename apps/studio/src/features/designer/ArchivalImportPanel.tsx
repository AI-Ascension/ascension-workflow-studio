import { Notice } from "../../components/Notice";

export interface ArchivalImport {
  schemaVersion: string;
  rawText: string;
  reason: string;
}

export function ArchivalImportPanel({ archival }: { archival: ArchivalImport }): JSX.Element {
  return <section className="raw-definition-panel panel-card archival-import" aria-label="Read-only archival import">
    <Notice tone="warning" title="Read-only archival import">{`${archival.schemaVersion}: ${archival.reason}`}</Notice>
    <p className="muted">The original import text is retained locally for review only. It is not applied to this draft, autosaved, validated, or published.</p>
    <textarea value={archival.rawText} rows={12} readOnly spellCheck={false} aria-label="Archived unsupported workflow definition JSON" />
  </section>;
}
