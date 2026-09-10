import { useState } from "react";

import type { DefinitionRecord, ReplayResponse, WorkflowDefinition } from "@studio/contracts";
import type { StudioClient } from "@studio/client";

import { Notice } from "../../components/Notice";
import { StatusBadge } from "../../components/StatusBadge";

interface ReplayViewProps {
  client: StudioClient;
  mode: "fixture" | "live";
  definition: WorkflowDefinition;
  definitions: DefinitionRecord[];
}

export function ReplayView({ client, mode, definition, definitions }: ReplayViewProps): JSX.Element {
  const [runId, setRunId] = useState("run.fixture.1");
  const [compareId, setCompareId] = useState(definitions[0]?.id ?? "");
  const [result, setResult] = useState<ReplayResponse | undefined>();
  const [diff, setDiff] = useState<{ semantic_change: boolean; changed_paths: string[] } | undefined>();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const replay = async (): Promise<void> => {
    setBusy(true);
    setMessage("");
    try {
      const [nextReplay, nextDiff] = await Promise.all([
        client.replay(runId),
        client.diff(definition, definitions.find((candidate) => candidate.id === compareId)?.definition ?? definition),
      ]);
      setResult(nextReplay);
      setDiff(nextDiff);
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : "Replay request failed.");
    } finally {
      setBusy(false);
    }
  };

  const downloadExport = async (): Promise<void> => {
    try {
      const exported = await client.export(runId);
      const blob = new Blob([JSON.stringify(exported, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${runId.replaceAll(/[^A-Za-z0-9._-]/g, "_")}-redacted.json`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : "Export request failed.");
    }
  };

  return <section className="view-stack" aria-labelledby="replay-title">
    <div className="view-heading"><div><p className="eyebrow">Workspace / Replay</p><h1 id="replay-title">Replay & compare</h1><p className="lede">Reconstruct retained owner history offline and compare admitted semantic definitions.</p></div><StatusBadge tone={mode === "fixture" ? "fixture" : "live"}>{mode === "fixture" ? "fixture history" : "live API"}</StatusBadge></div>
    {mode === "live" ? <Notice tone="info" title="Offline replay boundary">Replay requests use the owner’s redacted event export. No browser-side scheduler or game action is created.</Notice> : null}
    <div className="replay-controls panel-card"><label className="field-label">Run ID<input value={runId} onChange={(event) => setRunId(event.target.value)} /></label><label className="field-label">Compare against<select value={compareId} onChange={(event) => setCompareId(event.target.value)}>{definitions.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.title}</option>)}</select></label><button className="button button-primary" onClick={() => void replay()} disabled={busy}>{busy ? "Comparing…" : "Replay offline"}</button><button className="button button-secondary" onClick={() => void downloadExport()}>Export redacted JSON</button></div>
    {message ? <Notice tone="danger" title="Replay error">{message}</Notice> : null}
    {result ? <div className="replay-grid"><section className="panel-card"><div className="panel-title"><div><p className="eyebrow">Replay result</p><h2>{result.matched ? "History matched" : "Divergence found"}</h2></div><StatusBadge tone={result.matched ? "success" : "danger"}>{result.matched ? "matched" : "diverged"}</StatusBadge></div><dl className="detail-list"><div><dt>Compared events</dt><dd>{result.compared_events}</dd></div><div><dt>First divergence</dt><dd>{result.first_divergence ? `${result.first_divergence.path} · ${result.first_divergence.code}` : "None"}</dd></div></dl></section><section className="panel-card"><div className="panel-title"><div><p className="eyebrow">Definition compare</p><h2>{diff?.semantic_change ? "Semantic changes" : "No semantic changes"}</h2></div><StatusBadge tone={diff?.semantic_change ? "warning" : "success"}>{diff?.semantic_change ? "changed" : "equal"}</StatusBadge></div>{diff?.changed_paths.length ? <ul className="plain-list">{diff.changed_paths.map((path) => <li key={path}><code>{path}</code></li>)}</ul> : <p className="muted">The selected definition compares equal to itself; layout movement is excluded from semantic identity.</p>}</section></div> : <div className="empty-panel"><p>Choose a run ID to begin an evidence-backed replay.</p></div>}
  </section>;
}
