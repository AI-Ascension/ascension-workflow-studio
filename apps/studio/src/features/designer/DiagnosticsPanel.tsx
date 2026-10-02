import { type ValidateResponse, ownerInferenceProfileDecision } from "@studio/contracts";

import { StatusBadge } from "../../components/StatusBadge";

export function DiagnosticsPanel({ result, onFocusPath }: { result: ValidateResponse; onFocusPath: (path: string) => void }): JSX.Element {
  /* The owner's decision is REPORTED here, never derived. This panel shows
   * exactly what the owner published: a floating `profile_ref` is shown as the
   * author left it, alongside the exact revision the owner resolved it to.
   * Nothing in this component rewrites the document, upgrades a reference, or
   * speaks for an owner that published nothing. */
  const profileDecision = ownerInferenceProfileDecision(result.inference_profiles);
  return <div className={`diagnostics-panel ${result.valid ? "diagnostics-valid" : "diagnostics-invalid"}`}>
    <div className="panel-title"><div><p className="eyebrow">Owner validation</p><h2>{result.valid ? "Definition admitted" : "Definition needs attention"}</h2></div><span className="validation-identity"><code>{result.definition_digest.slice(0, 16)}…</code>{result.compiler ? <code className="compile-identity">compiler {result.compiler}</code> : null}</span></div>
    {result.diagnostics.length === 0 ? <p className="muted">No diagnostics returned by the active adapter.</p> : <ul className="diagnostics-list">{result.diagnostics.map((diagnostic, index) => <li key={`${diagnostic.code}-${index}`}><StatusBadge tone={diagnostic.severity === "error" ? "danger" : diagnostic.severity === "warning" ? "warning" : "muted"}>{diagnostic.severity}</StatusBadge><button className="diagnostic-target" onClick={() => onFocusPath(diagnostic.path)} aria-label={`Focus diagnostic ${diagnostic.path}`}><code>{diagnostic.path}</code></button><span>{diagnostic.message}</span></li>)}</ul>}
    <div className="profile-decision" data-decision={profileDecision.kind}>
      <p className="eyebrow">Owner profile decision</p>
      <p className="muted">{profileDecision.message}</p>
      {profileDecision.entries?.length ? <ul className="profile-decision-list">{profileDecision.entries.map((entry) => <li key={`${entry.graph_id}/${entry.node_id}`}><button className="diagnostic-target" onClick={() => onFocusPath(entry.path)} aria-label={`Focus ${entry.path}`}><code>{entry.path}</code></button><span><code>{entry.profile_ref}</code> → <code>{entry.resolved_pin}</code></span></li>)}</ul> : null}
    </div>
  </div>;
}
