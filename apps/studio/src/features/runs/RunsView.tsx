import { useCallback, useEffect, useRef, useState } from "react";

import type { CommandKind, CommandResponse, EventPage, RunEvent, StatusResponse } from "@studio/contracts";
import { ClientError, applyEventPage, createProjection, type RunProjection, type StudioClient } from "@studio/client";

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
  const [attempt, setAttempt] = useState<CommandAttempt | undefined>();
  const [cursorSequence, setCursorSequence] = useState<number | undefined>();
  const commandIds = useRef(new Map<string, string>());

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

  useEffect(() => {
    const timer = window.setInterval(() => { void refresh(); }, mode === "live" ? 5_000 : 10_000);
    return () => window.clearInterval(timer);
  }, [mode, refresh]);

  const selectRun = (): void => {
    const next = runInput.trim();
    if (!next) return;
    setRunId(next);
    onRunIdChange(next);
  };

  const submitAttempt = useCallback(async (next: CommandAttempt): Promise<void> => {
    setAttempt(next);
    try {
      const response = await client.command(next.runId, next.expectedRevision, next.kind, next.commandId);
      setAttempt({ ...next, state: "settled", response, error: undefined });
      await refresh(next.runId);
    } catch (error: unknown) {
      if (error instanceof ClientError && typeof error.status === "number" && error.status < 500) {
        setAttempt({ ...next, state: "settled", response: undefined, error: error.message });
      } else {
        setAttempt({ ...next, state: "unknown", response: undefined, error: error instanceof Error ? error.message : "No response from the owner." });
      }
    }
  }, [client, refresh]);

  const events = projection?.events ?? [];
  const historical = cursorSequence !== undefined;
  const cursorIndex = ((): number => {
    if (events.length === 0) return 0;
    if (cursorSequence === undefined) return events.length - 1;
    let index = 0;
    events.forEach((event, candidate) => { if (event.sequence <= cursorSequence) index = candidate; });
    return index;
  })();
  const displayedEvent = events[cursorIndex];
  const visibleEvents = historical ? events.slice(0, cursorIndex + 1) : events;
  const stepCursor = (offset: number): void => {
    if (events.length === 0) return;
    const next = Math.min(Math.max(cursorIndex + offset, 0), events.length - 1);
    setCursorSequence(events[next].sequence);
  };
  const enterHistory = (): void => setCursorSequence(events[events.length - 1]?.sequence);
  const returnToLive = (): void => setCursorSequence(undefined);

  const commandLocked = attempt?.state === "sending" || attempt?.state === "unknown" || historical;
  const busyCommand = attempt?.state === "sending" ? attempt.kind : undefined;

  const sendCommand = async (kind: CommandKind): Promise<void> => {
    if (!status || commandLocked) return;
    const commandKey = `${status.run.workflow_run_id}:${status.run.run_revision}:${kind}`;
    const commandId = commandIds.current.get(commandKey) ?? `studio.command.${Date.now()}.${commandIds.current.size}`;
    commandIds.current.set(commandKey, commandId);
    await submitAttempt({ kind, commandId, runId: status.run.workflow_run_id, expectedRevision: status.run.run_revision, state: "sending" });
  };

  const resolveCommand = async (): Promise<void> => {
    if (attempt?.state !== "unknown") return;
    await submitAttempt({ ...attempt, state: "sending" });
  };

  const canPause = status?.run.status === "running" || status?.run.status === "waiting_for_game" || status?.run.status === "waiting_for_provider";
  const canResume = status?.run.status === "paused" || status?.run.status === "pausing";
  const canStep = status?.run.status === "paused";
  const canCancel = Boolean(status && !["completed", "failed", "cancelled"].includes(status.run.status));

  return <section className="view-stack" aria-labelledby="runs-title">
    <div className="view-heading">
      <div><p className="eyebrow">Workspace / Runs</p><h1 id="runs-title">Run inspector</h1><p className="lede">Observe owner snapshots and retained events with revision-safe controls.</p></div>
      <div className="heading-actions"><StatusBadge tone={mode === "fixture" ? "fixture" : "live"}>{mode === "fixture" ? "fixture projection" : "live API"}</StatusBadge><span className="muted">bounded polling · {mode === "live" ? "5s" : "10s"}</span></div>
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
          <div className="panel-title"><div><p className="eyebrow">Safe controls</p><h2 id="controls-title">Operator actions</h2></div><StatusBadge tone={historical ? "warning" : "success"}>{historical ? "historical cursor" : "live"}</StatusBadge></div>
          <p className="muted">Every command includes this run ID and the displayed revision. The owner remains responsible for admission and settlement.</p>
          {attempt ? (() => { const described = describeCommand(attempt); return <div className="command-outcome" role="status" data-command-state={attempt.state}><StatusBadge tone={described.tone}>{described.label}</StatusBadge><span className="command-detail">{described.detail}</span>{attempt.state === "unknown" ? <button className="button button-secondary" onClick={() => void resolveCommand()}>Check outcome</button> : null}</div>; })() : null}
          <div className="control-grid">
            <CommandButton label="Pause" kind="pause" enabled={Boolean(canPause)} busy={busyCommand} locked={commandLocked} onClick={sendCommand} />
            <CommandButton label="Resume" kind="resume" enabled={Boolean(canResume)} busy={busyCommand} locked={commandLocked} onClick={sendCommand} />
            <CommandButton label="Step" kind="step" enabled={Boolean(canStep)} busy={busyCommand} locked={commandLocked} onClick={sendCommand} />
            <CommandButton label="Cancel" kind="cancel" enabled={Boolean(canCancel)} busy={busyCommand} locked={commandLocked} onClick={sendCommand} danger />
          </div>
          {historical ? <p className="field-unknown" role="status">Historical cursor: live controls are disabled while viewing a recorded cut.</p> : null}
        </section>
        <section className="panel-card" aria-labelledby="authority-title">
          <div className="panel-title"><div><p className="eyebrow">Authority boundary</p><h2 id="authority-title">Control plane state</h2></div><StatusBadge tone={status.authority.state === "healthy" ? "success" : "warning"}>{status.authority.state}</StatusBadge></div>
          <dl className="detail-list"><div><dt>Definition digest</dt><dd><code>{status.run.definition_digest}</code></dd></div><div><dt>Game outcome</dt><dd>{status.run.game_outcome.replaceAll("_", " ")}</dd></div><div><dt>Cleanup</dt><dd>{status.run.cleanup.replaceAll("_", " ")}</dd></div><div><dt>Waiting reason</dt><dd>{status.waiting_reason ?? "—"}</dd></div><div><dt>Pending operation</dt><dd>{status.run.pending_operation ? `${status.run.pending_operation.operation_id} · ${status.run.pending_operation.state}` : "None"}</dd></div></dl>
        </section>
      </div>
      <section className="panel-card" aria-labelledby="budget-title"><div className="panel-title"><div><p className="eyebrow">Resource projection</p><h2 id="budget-title">Budget and invocation</h2></div><span className="muted">owner snapshot</span></div><div className="budget-grid"><Metric label="Provider calls" value={`${status.run.budget.provider_calls_consumed} / ${status.run.budget.provider_calls_reserved}`} /><Metric label="Node steps" value={String(status.run.budget.node_steps_consumed)} /><Metric label="Replans" value={String(status.run.budget.replans_consumed)} /><Metric label="Node execution" value={status.run.cursor.node_execution_id} /></div></section>
      <section className="panel-card timeline-card" aria-labelledby="timeline-title">
        <div className="panel-title"><div><p className="eyebrow">Retained event projection</p><h2 id="timeline-title">Timeline</h2></div><span className="muted">{visibleEvents.length} of {events.length} events</span></div>
        <div className="cursor-controls" aria-label="Historical cursor">
          <p className="muted">Scrubbing and stepping move only a display cursor. They send no runtime, provider, or game request and never launch a fresh game.</p>
          <div className="control-grid">
            <button className="button button-quiet" onClick={() => stepCursor(-1)} disabled={events.length === 0 || cursorIndex === 0}>Step back</button>
            <button className="button button-quiet" onClick={() => stepCursor(1)} disabled={events.length === 0 || cursorIndex >= events.length - 1}>Step forward</button>
            {historical ? <button className="button button-secondary" onClick={returnToLive}>Return to live</button> : <button className="button button-secondary" onClick={enterHistory} disabled={events.length === 0}>Enter history</button>}
            <input type="range" aria-label="Event cursor" min={0} max={Math.max(0, events.length - 1)} value={cursorIndex} onChange={(event) => { const next = events[Number(event.target.value)]; if (next) setCursorSequence(next.sequence); }} disabled={events.length === 0} />
          </div>
          {displayedEvent ? <p className="muted">Cursor at sequence <code>{displayedEvent.sequence}</code> · {displayedEvent.event_type} · revision {displayedEvent.run_revision}</p> : null}
        </div>
        {visibleEvents.length ? <ol className="event-timeline">{visibleEvents.map((event, index) => <EventRow event={event} key={event.sequence} current={historical && index === cursorIndex} onSelect={historical ? (sequence) => setCursorSequence(sequence) : undefined} />)}</ol> : <p className="muted">No retained events were returned.</p>}
      </section>
    </> : <div className="loading-panel">{state === "loading" ? "Loading owner snapshot…" : "Enter a run ID to inspect it."}</div>}
  </section>;
}

function Metric({ label, value, detail, tone = "muted" }: { label: string; value: string; detail?: string; tone?: "live" | "success" | "danger" | "muted" }): JSX.Element {
  return <div className="metric-card"><span className="metric-label">{label}</span><strong className={`metric-value metric-${tone}`}>{value}</strong>{detail ? <span className="metric-detail">{detail}</span> : null}</div>;
}

function CommandButton({ label, kind, enabled, busy, locked, danger, onClick }: { label: string; kind: CommandKind; enabled: boolean; busy: CommandKind | undefined; locked: boolean; danger?: boolean; onClick: (kind: CommandKind) => Promise<void> }): JSX.Element {
  return <button className={`button ${danger ? "button-danger-outline" : "button-secondary"}`} disabled={!enabled || locked || Boolean(busy)} onClick={() => void onClick(kind)}>{busy === kind ? "Sending…" : label}</button>;
}

interface CommandAttempt {
  kind: CommandKind;
  commandId: string;
  runId: string;
  expectedRevision: number;
  state: "sending" | "unknown" | "settled";
  response?: CommandResponse;
  error?: string;
}

function describeCommand(attempt: CommandAttempt): { tone: "success" | "warning" | "muted" | "danger"; label: string; detail: string } {
  if (attempt.state === "sending") return { tone: "warning", label: "sending", detail: `Sending command ${attempt.commandId}…` };
  if (attempt.state === "unknown") return { tone: "warning", label: "unknown", detail: `No response for command ${attempt.commandId}. The owner may have admitted it; check the original ID before another intent.` };
  if (attempt.error) return { tone: "danger", label: "rejected", detail: `Command ${attempt.commandId} was rejected before application: ${attempt.error}` };
  const outcome = attempt.response?.outcome;
  const revision = attempt.response?.run_revision;
  if (outcome === "accepted") return { tone: "warning", label: "accepted", detail: `Command ${attempt.commandId} was admitted but not applied; reconciliation continues.` };
  if (outcome === "pending") return { tone: "warning", label: "pending", detail: `Command ${attempt.commandId} is pending; application is not confirmed.` };
  if (outcome === "applied") return { tone: "success", label: "applied", detail: `Command ${attempt.commandId} applied at revision ${revision}.` };
  if (outcome === "duplicate") return { tone: "muted", label: "duplicate", detail: `Command ${attempt.commandId} already resolved; the owner returned the existing outcome at revision ${revision}.` };
  return { tone: "muted", label: "settled", detail: `Command ${attempt.commandId} settled.` };
}

function EventRow({ event, current, onSelect }: { event: RunEvent; current: boolean; onSelect?: (sequence: number) => void }): JSX.Element {
  return <li className={`event-row ${current ? "event-row-current" : ""}`}><span className="event-sequence">{event.sequence}</span><span className="event-marker" aria-hidden="true" /><div><strong>{event.event_type.replaceAll("_", " ")}</strong><p>{event.payload.reason_code}{event.payload.operation_id ? ` · ${event.payload.operation_id}` : ""}</p>{onSelect ? <button className="button button-quiet event-cursor-button" onClick={() => onSelect(event.sequence)}>Set cursor</button> : null}</div><code>rev {event.run_revision}</code></li>;
}
