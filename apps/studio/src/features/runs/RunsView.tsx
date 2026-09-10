import { useCallback, useEffect, useState } from "react";

import type { CommandKind, EventPage, RunEvent, StatusResponse } from "@studio/contracts";
import { applyEventPage, createProjection, type RunProjection, type StudioClient } from "@studio/client";

import { Notice } from "../../components/Notice";
import { StatusBadge } from "../../components/StatusBadge";

interface RunsViewProps {
  client: StudioClient;
  mode: "fixture" | "live";
  initialRunId: string;
  onRunIdChange: (runId: string) => void;
}

export function RunsView({ client, mode, initialRunId, onRunIdChange }: RunsViewProps): JSX.Element {
  const [runId, setRunId] = useState(initialRunId);
  const [runInput, setRunInput] = useState(initialRunId);
  const [status, setStatus] = useState<StatusResponse | undefined>();
  const [projection, setProjection] = useState<RunProjection | undefined>();
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error" | "resnapshot">("idle");
  const [message, setMessage] = useState("");
  const [busyCommand, setBusyCommand] = useState<CommandKind | undefined>();

  const refresh = useCallback(async (requestedRunId = runId): Promise<void> => {
    setState("loading");
    setMessage("");
    try {
      const nextStatus = await client.status(requestedRunId);
      const nextProjection = createProjection(requestedRunId, nextStatus.run.definition_digest);
      const page: EventPage = await client.events(requestedRunId, 0);
      const applied = applyEventPage(nextProjection, page);
      setStatus(nextStatus);
      setProjection(applied.kind === "resnapshot" ? nextProjection : applied.projection);
      setState(applied.kind === "resnapshot" ? "resnapshot" : "ready");
      setMessage(applied.kind === "resnapshot" ? applied.reason : `Loaded ${page.events.length} retained event${page.events.length === 1 ? "" : "s"}.`);
    } catch (error: unknown) {
      setState("error");
      setMessage(error instanceof Error ? error.message : "Run inspection failed.");
    }
  }, [client, runId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const selectRun = (): void => {
    const next = runInput.trim();
    if (!next) return;
    setRunId(next);
    onRunIdChange(next);
  };

  const sendCommand = async (kind: CommandKind): Promise<void> => {
    if (!status) return;
    setBusyCommand(kind);
    try {
      await client.command(status.run.workflow_run_id, status.run.run_revision, kind);
      await refresh(status.run.workflow_run_id);
    } catch (error: unknown) {
      setState("error");
      setMessage(error instanceof Error ? error.message : "Command failed.");
    } finally {
      setBusyCommand(undefined);
    }
  };

  const canPause = status?.run.status === "running" || status?.run.status === "waiting_for_game" || status?.run.status === "waiting_for_provider";
  const canResume = status?.run.status === "paused" || status?.run.status === "pausing";
  const canStep = status?.run.status === "paused";
  const canCancel = Boolean(status && !["completed", "failed", "cancelled"].includes(status.run.status));

  return <section className="view-stack" aria-labelledby="runs-title">
    <div className="view-heading">
      <div><p className="eyebrow">Workspace / Runs</p><h1 id="runs-title">Run inspector</h1><p className="lede">Observe owner snapshots and retained events with revision-safe controls.</p></div>
      <StatusBadge tone={mode === "fixture" ? "fixture" : "live"}>{mode === "fixture" ? "fixture projection" : "live API"}</StatusBadge>
    </div>
    <div className="run-selector">
      <label className="field-label">Run ID<input value={runInput} onChange={(event) => setRunInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") selectRun(); }} placeholder="run.fixture.1" /></label>
      <button className="button button-secondary selector-button" onClick={selectRun}>Inspect</button>
      <button className="button button-quiet selector-button" onClick={() => void refresh()} disabled={state === "loading"}>Refresh</button>
    </div>
    {mode === "live" ? <Notice tone="info" title="Live route admission">The Phase 1 owner exposes inspection by explicit run ID. A run-list route is not admitted, so this view does not invent one.</Notice> : null}
    {message ? <div className={`notice notice-${state === "error" ? "danger" : state === "resnapshot" ? "warning" : "info"}`}><strong>{state === "error" ? "Inspection error" : state === "resnapshot" ? "Resnapshot required" : "Projection"}</strong><span>{message}</span></div> : null}
    {status ? <>
      <div className="metric-grid">
        <Metric label="Status" value={status.run.status} tone={status.run.status === "running" ? "live" : status.run.status === "failed" ? "danger" : "success"} />
        <Metric label="Revision" value={String(status.run.run_revision)} detail={`event ${status.last_progress_sequence}`} />
        <Metric label="Cursor" value={`${status.run.cursor.graph_id} / ${status.run.cursor.node_id}`} detail={status.run.cursor.node_execution_id} />
        <Metric label="Recovery" value={status.recovery_admission.kind.replaceAll("_", " ")} detail={status.authority.recovery} tone={status.recovery_admission.kind === "needs_operator" ? "danger" : "success"} />
      </div>
      <div className="run-grid">
        <section className="panel-card controls-card" aria-labelledby="controls-title">
          <div className="panel-title"><div><p className="eyebrow">Safe controls</p><h2 id="controls-title">Operator actions</h2></div><span className="muted">actor scope: workflow:control</span></div>
          <p className="muted">Every command includes this run ID and the displayed revision. The owner remains responsible for admission and settlement.</p>
          <div className="control-grid">
            <CommandButton label="Pause" kind="pause" enabled={Boolean(canPause)} busy={busyCommand} onClick={sendCommand} />
            <CommandButton label="Resume" kind="resume" enabled={Boolean(canResume)} busy={busyCommand} onClick={sendCommand} />
            <CommandButton label="Step" kind="step" enabled={Boolean(canStep)} busy={busyCommand} onClick={sendCommand} />
            <CommandButton label="Cancel" kind="cancel" enabled={Boolean(canCancel)} busy={busyCommand} onClick={sendCommand} danger />
          </div>
        </section>
        <section className="panel-card" aria-labelledby="authority-title">
          <div className="panel-title"><div><p className="eyebrow">Authority boundary</p><h2 id="authority-title">Control plane state</h2></div><StatusBadge tone={status.authority.state === "healthy" ? "success" : "warning"}>{status.authority.state}</StatusBadge></div>
          <dl className="detail-list"><div><dt>Definition digest</dt><dd><code>{status.run.definition_digest}</code></dd></div><div><dt>Game outcome</dt><dd>{status.run.game_outcome.replaceAll("_", " ")}</dd></div><div><dt>Cleanup</dt><dd>{status.run.cleanup.replaceAll("_", " ")}</dd></div><div><dt>Waiting reason</dt><dd>{status.waiting_reason ?? "—"}</dd></div></dl>
        </section>
      </div>
      <section className="panel-card timeline-card" aria-labelledby="timeline-title">
        <div className="panel-title"><div><p className="eyebrow">Retained event projection</p><h2 id="timeline-title">Timeline</h2></div><span className="muted">{projection?.events.length ?? 0} events</span></div>
        {projection?.events.length ? <ol className="event-timeline">{projection.events.map((event) => <EventRow event={event} key={event.sequence} />)}</ol> : <p className="muted">No retained events were returned.</p>}
      </section>
    </> : <div className="loading-panel">{state === "loading" ? "Loading owner snapshot…" : "Enter a run ID to inspect it."}</div>}
  </section>;
}

function Metric({ label, value, detail, tone = "muted" }: { label: string; value: string; detail?: string; tone?: "live" | "success" | "danger" | "muted" }): JSX.Element {
  return <div className="metric-card"><span className="metric-label">{label}</span><strong className={`metric-value metric-${tone}`}>{value}</strong>{detail ? <span className="metric-detail">{detail}</span> : null}</div>;
}

function CommandButton({ label, kind, enabled, busy, danger, onClick }: { label: string; kind: CommandKind; enabled: boolean; busy: CommandKind | undefined; danger?: boolean; onClick: (kind: CommandKind) => Promise<void> }): JSX.Element {
  return <button className={`button ${danger ? "button-danger-outline" : "button-secondary"}`} disabled={!enabled || Boolean(busy)} onClick={() => void onClick(kind)}>{busy === kind ? "Sending…" : label}</button>;
}

function EventRow({ event }: { event: RunEvent }): JSX.Element {
  return <li className="event-row"><span className="event-sequence">{event.sequence}</span><span className="event-marker" aria-hidden="true" /><div><strong>{event.event_type.replaceAll("_", " ")}</strong><p>{event.payload.reason_code}{event.payload.operation_id ? ` · ${event.payload.operation_id}` : ""}</p></div><code>rev {event.run_revision}</code></li>;
}
