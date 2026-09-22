import { type RecoveryRecord } from "@studio/document";

import { StatusBadge } from "../../components/StatusBadge";

export function RecoveryPanel({ enabled, principal, count, recoverable, notice, onToggle, onRecover, onExport, onClear }: { enabled: boolean; principal: string; count: number; recoverable: RecoveryRecord | undefined; notice: string; onToggle: () => void; onRecover: () => void; onExport: () => void; onClear: () => void }): JSX.Element {
  return <section className="recovery-panel panel-card" aria-label="Local crash recovery">
    <div className="panel-title"><div><p className="eyebrow">Optional local recovery</p><h2>Crash-recovery buffer</h2></div><StatusBadge tone={enabled ? "success" : "muted"}>{enabled ? "on" : "off"}</StatusBadge></div>
    <p className="muted">Sanitized authoring data only (document, layout, raw text) with a 24-hour TTL, bound to principal <code>{principal}</code>. Tokens, live run snapshots, provider outputs and commands are never stored.</p>
    <div className="control-grid">
      <button className="button button-quiet" onClick={onToggle}>{enabled ? "Disable recovery" : "Enable recovery"}</button>
      <button className="button button-secondary" onClick={onRecover} disabled={!recoverable}>Recover unsaved candidate</button>
      <button className="button button-quiet" onClick={onExport} disabled={count === 0}>Export recovery</button>
      <button className="button button-quiet" onClick={onClear} disabled={count === 0}>Clear local recovery</button>
    </div>
    <p className="muted">Stored records for this principal: {count}{recoverable ? ` · recoverable from ${recoverable.saved_at}` : ""}</p>
    {notice ? <p className="field-unknown" role="status">{notice}</p> : null}
  </section>;
}
