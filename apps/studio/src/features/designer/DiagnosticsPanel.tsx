import { type ValidateResponse } from "@studio/contracts";

import { StatusBadge } from "../../components/StatusBadge";

export function DiagnosticsPanel({ result, onFocusPath }: { result: ValidateResponse; onFocusPath: (path: string) => void }): JSX.Element {
  return <div className={`diagnostics-panel ${result.valid ? "diagnostics-valid" : "diagnostics-invalid"}`}>
    <div className="panel-title"><div><p className="eyebrow">Owner validation</p><h2>{result.valid ? "Definition admitted" : "Definition needs attention"}</h2></div><span className="validation-identity"><code>{result.definition_digest.slice(0, 16)}…</code>{result.compiler ? <code className="compile-identity">compiler {result.compiler}</code> : null}</span></div>
    {result.diagnostics.length === 0 ? <p className="muted">No diagnostics returned by the active adapter.</p> : <ul className="diagnostics-list">{result.diagnostics.map((diagnostic, index) => <li key={`${diagnostic.code}-${index}`}><StatusBadge tone={diagnostic.severity === "error" ? "danger" : diagnostic.severity === "warning" ? "warning" : "muted"}>{diagnostic.severity}</StatusBadge><button className="diagnostic-target" onClick={() => onFocusPath(diagnostic.path)} aria-label={`Focus diagnostic ${diagnostic.path}`}><code>{diagnostic.path}</code></button><span>{diagnostic.message}</span></li>)}</ul>}
  </div>;
}
