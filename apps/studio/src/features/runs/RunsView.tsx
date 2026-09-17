import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";

import type { CommandKind, CommandResponse, ContextAssociation, ContextEventPage, ContextOwnerAssociation, ContextOwnerEffectiveLimits, ContextSnapshotManifest, EventPage, RunEvent, StatusResponse } from "@studio/contracts";
import { effectiveLimit, effectiveLimitDisclosure } from "@studio/contracts";
import { ClientError, applyEventPage, createProjection, type ContextServiceClient, type ProviderSessionPolicyClient, type RunProjection, type StudioClient } from "@studio/client";
import { mapProjectionSupport, pinnedMapIdentity, resolveApprovedLink, VisibleMapProjectionSchema, type ApprovedLinkMapping, type VisibleMapProjection } from "@studio/document";

import { Notice } from "../../components/Notice";
import { StatusBadge } from "../../components/StatusBadge";
import { ProviderSessionPolicyPanel } from "./ProviderSessionPolicyPanel";

interface RunsViewProps {
  client: StudioClient;
  policyClient?: ProviderSessionPolicyClient;
  contextClient: ContextServiceClient;
  mode: "fixture" | "live";
  initialRunId: string;
  onRunIdChange: (runId: string) => void;
  linkMappings: ApprovedLinkMapping[];
}

export function RunsView({ client, policyClient, contextClient, mode, initialRunId, onRunIdChange, linkMappings }: RunsViewProps): JSX.Element {
  const [runId, setRunId] = useState(initialRunId);
  const [runInput, setRunInput] = useState(initialRunId);
  const [status, setStatus] = useState<StatusResponse | undefined>();
  const [projection, setProjection] = useState<RunProjection | undefined>();
  const [contextAssociation, setContextAssociation] = useState<ContextAssociation | undefined>();
  const [ownerAssociation, setOwnerAssociation] = useState<ContextOwnerAssociation | undefined>();
  const [ownerLimits, setOwnerLimits] = useState<ContextOwnerEffectiveLimits | undefined>();
  const [ownerMessage, setOwnerMessage] = useState<string | undefined>();
  const [contextMessage, setContextMessage] = useState<string | undefined>();
  const [contextSnapshotMessage, setContextSnapshotMessage] = useState<string | undefined>();
  const [contextManifest, setContextManifest] = useState<ContextSnapshotManifest | undefined>();
  const [contextEvents, setContextEvents] = useState<ContextEventPage | undefined>();
  const [contextEventsMessage, setContextEventsMessage] = useState<string | undefined>();
  const [memoryMessage, setMemoryMessage] = useState("Memory search is unavailable from this owner.");
  const [sessionMessage, setSessionMessage] = useState("Provider-session inspection is unavailable from this owner.");
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error" | "resnapshot">("idle");
  const [message, setMessage] = useState("");
  const [attempt, setAttempt] = useState<CommandAttempt | undefined>();
  const [cursorSequence, setCursorSequence] = useState<number | undefined>();
  const [referenceProbe, setReferenceProbe] = useState("");
  const [mapProjection, setMapProjection] = useState<VisibleMapProjection | undefined>();
  const [mapError, setMapError] = useState<string | undefined>();
  const commandIds = useRef(new Map<string, string>());
  const latestRefresh = useRef(0);

  const refresh = useCallback(async (requestedRunId = runId): Promise<void> => {
    const refreshId = ++latestRefresh.current;
    const setCurrentMemoryMessage = (value: string): void => {
      if (refreshId === latestRefresh.current) setMemoryMessage(value);
    };
    const setCurrentSessionMessage = (value: string): void => {
      if (refreshId === latestRefresh.current) setSessionMessage(value);
    };
    setCurrentMemoryMessage("Effective input limits unavailable while the current owner association is refreshed.");
    setCurrentSessionMessage("Effective input limits unavailable while the current owner association is refreshed.");
    setState("loading");
    setMessage("");
    try {
      const nextStatus = await client.status(requestedRunId);
      const nextProjection = createProjection(requestedRunId, nextStatus.run.definition_digest);
      const [page, association, currentOwner] = await Promise.all([
        client.events(requestedRunId, 0),
        client.contextAssociation(requestedRunId).then((value) => ({ value })).catch((error: unknown) => ({ error })),
        client.contextOwnerAssociation(requestedRunId).then((value) => ({ value })).catch((error: unknown) => ({ error })),
      ]);
      const applied = applyEventPage(nextProjection, page);
      setStatus(nextStatus);
      if ("value" in currentOwner) {
        setOwnerAssociation(currentOwner.value);
        setOwnerMessage(undefined);
        try {
          const limits = await client.contextOwnerEffectiveLimits(requestedRunId);
          if (limits.binding_id !== currentOwner.value.binding.binding_id
            || limits.binding_digest !== currentOwner.value.binding.binding_digest
            || limits.context_ref !== currentOwner.value.binding.context_ref) {
            throw new Error("Effective limits were rejected because they name a different current owner binding.");
          }
          setOwnerLimits(limits);
        } catch (error: unknown) {
          setOwnerLimits(undefined);
          setOwnerMessage(error instanceof Error ? error.message : "Current owner effective limits are unavailable.");
        }
      } else {
        setOwnerAssociation(undefined);
        setOwnerLimits(undefined);
        setOwnerMessage(currentOwner.error instanceof ClientError && currentOwner.error.code === "context_owner_association_unavailable"
          ? "Current context owner association is unavailable."
          : currentOwner.error instanceof Error ? currentOwner.error.message : "Current context owner association is unavailable.");
      }
      if ("value" in association) {
        setContextAssociation(association.value);
        setContextMessage(undefined);
        const contextRunId = association.value.context.run_id;
        if (association.value.context.availability === "available" && contextRunId && association.value.context.snapshot_id) {
          try {
            const snapshots = await contextClient.snapshots(contextRunId);
            const current = snapshots.snapshots.find((item) => item.snapshot_id === association.value.context.snapshot_id);
            setContextSnapshotMessage(current
              ? `${current.component_count} component(s) · ${current.capture_mode} capture · ${current.application_capture_complete ? "complete" : `incomplete: ${current.incomplete_reasons.join(", ") || "reason not disclosed"}`}`
              : "The owner did not disclose the bound snapshot in this scoped context run.");
          } catch { setContextSnapshotMessage("Context snapshot metadata is unavailable from the composed context owner."); }
          try {
            const [manifest, events] = await Promise.all([
              contextClient.snapshot(contextRunId, association.value.context.snapshot_id),
              contextClient.events(contextRunId),
            ]);
            const expected = association.value.context;
            if (manifest.snapshot_id !== expected.snapshot_id || manifest.identity.run_id !== contextRunId || manifest.identity.episode_id !== expected.episode_id || manifest.identity.agent_id !== expected.agent_id) {
              setContextManifest(undefined);
              setContextEvents(undefined);
              setContextEventsMessage("Context manifest was rejected because its bound identity differs from the workflow association.");
            } else if (events.run_id !== contextRunId) {
              setContextManifest(undefined);
              setContextEvents(undefined);
              setContextEventsMessage("Context event page was rejected because it names a different Context run.");
            } else {
              setContextManifest(manifest);
              setContextEvents(events);
              setContextEventsMessage(events.gap ? "The Context owner reports a retained-event capture gap." : undefined);
            }
          } catch {
            setContextManifest(undefined);
            setContextEvents(undefined);
            setContextEventsMessage("Context component and event metadata is unavailable from the composed context owner.");
          }
        } else {
          setContextSnapshotMessage("No retained context snapshot is available for this workflow invocation.");
          setContextManifest(undefined);
          setContextEvents(undefined);
          setContextEventsMessage(undefined);
        }
        if (association.value.capabilities.memory_search && contextRunId) {
          try {
            const memory = await contextClient.memoryCapabilities();
            const expected = association.value.context;
            if (memory.scope.run_id !== contextRunId || memory.scope.episode_id !== expected.episode_id || memory.scope.agent_id !== expected.agent_id) {
              setCurrentMemoryMessage("Memory projection was rejected because the Context owner returned a different scoped identity.");
            } else {
              const limit = effectiveLimit(memory, "optional_byte_budget");
              const canDescribeSearch = memory.schema === "ascension.context-memory.capabilities.v1" || limit.state === "available";
              const availability = !memory.enabled ? "Memory projection is explicitly unavailable."
                : canDescribeSearch ? `Read-only memory search is available (${memory.supported_operations.join(", ") || "no operations disclosed"}).`
                  : "Memory projection was rejected.";
              setCurrentMemoryMessage(`${availability} ${effectiveLimitDisclosure(memory, "optional_byte_budget")}`);
            }
          } catch { setCurrentMemoryMessage("Memory projection is unavailable from the composed context owner."); }
        } else setCurrentMemoryMessage("Memory search is unavailable from this owner.");
        if (association.value.capabilities.provider_session_inspect) {
          try {
            const sessions = await client.providerSessions(requestedRunId);
            setCurrentSessionMessage(sessions.value.run_id === requestedRunId
              ? `Read-only session projection: ${sessions.value.bindings.length} binding(s), ${sessions.value.operations.length} operation(s).`
              : "Provider-session projection was rejected because the Harness returned a different workflow run identity.");
            if (sessions.value.run_id === requestedRunId && contextRunId) {
              try {
                const capabilities = await contextClient.providerSessionCapabilities(contextRunId);
                setCurrentSessionMessage(`Read-only session projection: ${sessions.value.bindings.length} binding(s), ${sessions.value.operations.length} operation(s). ${effectiveLimitDisclosure(capabilities, "max_prepared_bytes")} Private retention requires owner approval and authenticated encryption.`);
              } catch {
                setCurrentSessionMessage(`Read-only session projection: ${sessions.value.bindings.length} binding(s), ${sessions.value.operations.length} operation(s). Effective input limits unavailable from the composed context owner.`);
              }
            }
          } catch { setCurrentSessionMessage("Provider-session projection is unavailable from the Harness owner."); }
        } else setCurrentSessionMessage("Provider-session inspection is unavailable from this owner.");
      } else {
        setCurrentMemoryMessage("Effective input limits unavailable because the current owner association is unavailable.");
        setCurrentSessionMessage("Effective input limits unavailable because the current owner association is unavailable.");
        setContextAssociation(undefined);
        setContextMessage(association.error instanceof Error ? association.error.message : "Context inspection is unavailable from this owner.");
        setContextSnapshotMessage(undefined);
        setContextManifest(undefined);
        setContextEvents(undefined);
        setContextEventsMessage(undefined);
      }
      setProjection(applied.kind === "resnapshot" ? nextProjection : applied.projection);
      setState(applied.kind === "resnapshot" ? "resnapshot" : "ready");
      setMessage(applied.kind === "resnapshot" ? applied.reason : `Loaded ${page.events.length} retained event${page.events.length === 1 ? "" : "s"}.`);
    } catch (error: unknown) {
      setState("error");
      setMessage(error instanceof Error ? error.message : "Run inspection failed.");
    }
  }, [client, contextClient, runId]);

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

  const loadMoreContextEvents = async (): Promise<void> => {
    const contextRunId = contextAssociation?.context.run_id;
    const cursor = contextEvents?.next_cursor;
    if (!contextRunId || !cursor) return;
    try {
      const page = await contextClient.events(contextRunId, cursor);
      if (page.run_id !== contextRunId) throw new Error("Context owner returned a different run identity.");
      setContextEvents((current) => current ? { ...page, events: [...current.events, ...page.events].slice(-200) } : page);
      setContextEventsMessage(page.gap ? "The Context owner reports a retained-event capture gap." : undefined);
    } catch {
      setContextEventsMessage("The next Context event page is unavailable from the composed context owner.");
    }
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
          <p className="field-unknown" role="note">This run is pinned to its admitted definition digest. Later definition revisions do not affect it and cannot be applied from the browser.</p>
          <dl className="detail-list"><div><dt>Definition digest</dt><dd><code data-testid="run-definition-digest">{status.run.definition_digest}</code></dd></div><div><dt>Game outcome</dt><dd>{status.run.game_outcome.replaceAll("_", " ")}</dd></div><div><dt>Cleanup</dt><dd>{status.run.cleanup.replaceAll("_", " ")}</dd></div><div><dt>Waiting reason</dt><dd>{status.waiting_reason ?? "—"}</dd></div><div><dt>Pending operation</dt><dd>{status.run.pending_operation ? `${status.run.pending_operation.operation_id} · ${status.run.pending_operation.state}` : "None"}</dd></div></dl>
        </section>
      </div>
      <section className="panel-card" aria-label="Context evidence">
        <div className="panel-title"><div><p className="eyebrow">Bounded context evidence</p><h2>Context</h2></div><StatusBadge tone={contextAssociation?.context.availability === "available" ? "success" : "muted"}>{contextAssociation?.context.availability ?? "unavailable"}</StatusBadge></div>
        <p className="muted">This view presents owner-provided metadata for the current workflow cursor. It does not reveal retained content, create a provider request, or change run control state.</p>
        {contextAssociation ? <dl className="detail-list">
          <div><dt>Context reference</dt><dd>{contextAssociation.context.context_ref ?? "—"}</dd></div>
          <div><dt>Snapshot</dt><dd>{contextAssociation.context.snapshot_id ?? "—"}</dd></div>
          <div><dt>Capture</dt><dd>{contextAssociation.capture.mode} · {contextAssociation.capture.state}</dd></div>
          <div><dt>Capture attempt</dt><dd>{contextAssociation.capture.attempt_id ?? "—"}</dd></div>
          <div><dt>Reason</dt><dd>{contextAssociation.context.reason_code ?? contextAssociation.capture.reason_code ?? "—"}</dd></div>
        </dl> : <p className="field-unknown" role="status">{contextMessage ?? "Context inspection has not been loaded."}</p>}
        {contextAssociation ? <p className="field-unknown" role="status">{contextSnapshotMessage ?? "Context snapshot metadata has not been loaded."}</p> : null}
        {contextManifest ? <><dl className="detail-list"><div><dt>Bounded components</dt><dd>{contextManifest.components.length}</dd></div><div><dt>Boundary</dt><dd>{contextManifest.boundary}</dd></div></dl><ul className="plain-list">{contextManifest.components.map((component) => <li key={component.component_id}><code>{component.component_id}</code> · {component.kind} · {component.media_type} · {component.observed_bytes} bytes · {component.content_status}</li>)}</ul><p className="muted">Component metadata is shown without retained bytes, content references, or content-read actions.</p></> : null}
        {contextEvents ? <div><p className="muted">{contextEvents.events.length} retained Context event(s){contextEvents.gap ? " · capture gap reported" : ""}.</p><ul className="plain-list">{contextEvents.events.map((event) => <li key={event.event_id}><code>{event.sequence}</code> · {event.event_type} · snapshot {event.snapshot_id}</li>)}</ul>{contextEvents.next_cursor ? <button className="button button-quiet" onClick={() => void loadMoreContextEvents()}>Load more Context events</button> : null}</div> : null}
        {contextEventsMessage ? <p className="field-unknown" role="status">{contextEventsMessage}</p> : null}
        {historical ? <p className="field-unknown" role="status">Historical cursor: context controls remain unavailable in this view.</p> : null}
      </section>
      <section className="panel-card" aria-label="Current context owner association">
        <div className="panel-title"><div><p className="eyebrow">Current owner binding</p><h2>Context authority metadata</h2></div><StatusBadge tone={ownerAssociation ? "success" : "muted"}>{ownerAssociation ? ownerAssociation.binding.state : "unavailable"}</StatusBadge></div>
        <p className="muted">This projection is read-only. Owner grants and continuity claims describe the selected binding; they do not grant control to this inspection view.</p>
        {ownerAssociation ? <dl className="detail-list">
          <div><dt>Owner</dt><dd>{ownerAssociation.binding.owner_id} · {ownerAssociation.binding.owner_version}</dd></div>
          <div><dt>Invocation</dt><dd>{ownerAssociation.binding.invocation_id}</dd></div>
          <div><dt>Binding</dt><dd>{ownerAssociation.binding.binding_id} · v{ownerAssociation.binding.binding_version}</dd></div>
          <div><dt>Node</dt><dd>{ownerAssociation.binding.graph_id} / {ownerAssociation.binding.node_id} · {ownerAssociation.binding.node_execution_id}</dd></div>
          <div><dt>Grants</dt><dd>metadata {ownerAssociation.binding.grants.metadata_read ? "read" : "none"} · content {ownerAssociation.binding.grants.content_read ? "read" : "none"} · edit {ownerAssociation.binding.grants.edit ? "yes" : "no"} · control {ownerAssociation.binding.grants.control ? "yes" : "no"}</dd></div>
          <div><dt>Continuity</dt><dd>restart {ownerAssociation.binding.continuity.survives_controller_restart ? "survives" : "does not survive"} · receipt recovery {ownerAssociation.binding.continuity.receipt_recovery ? "advertised" : "unavailable"} · provider session {ownerAssociation.binding.continuity.provider_session_continuity ? "continuous" : "separate"}</dd></div>
        </dl> : <p className="field-unknown" role="status">{ownerMessage ?? "Current owner association has not been loaded."}</p>}
        {ownerLimits ? <dl className="detail-list">
          <div><dt>Effective limits</dt><dd>{ownerLimits.effective_limits.max_items} items · {ownerLimits.effective_limits.max_notes} notes · {ownerLimits.effective_limits.max_context_bytes} context bytes · {ownerLimits.effective_limits.max_objective_bytes} objective bytes · {ownerLimits.effective_limits.max_control_events} control events</dd></div>
          <div><dt>Owner revisions</dt><dd>{ownerLimits.adapter_revision} · {ownerLimits.model_revision}</dd></div>
        </dl> : null}
      </section>
      <section className="panel-card" aria-label="Memory evidence">
        <div className="panel-title"><div><p className="eyebrow">Memory</p><h2>Read-only provenance</h2></div><StatusBadge tone="muted">no controls</StatusBadge></div>
        <p className="muted">{memoryMessage}</p>
      </section>
      <section className="panel-card" aria-label="Provider session evidence">
        <div className="panel-title"><div><p className="eyebrow">Provider session</p><h2>Read-only continuity</h2></div><StatusBadge tone="muted">no controls</StatusBadge></div>
        <p className="muted">{sessionMessage}</p>
      </section>
      {mode === "live" && policyClient && state === "ready" && status?.run.workflow_run_id === runId
        ? <ProviderSessionPolicyPanel client={policyClient} runId={runId} />
        : null}
      <section className="panel-card" aria-label="Approved reference links"><div className="panel-title"><div><p className="eyebrow">References</p><h2>Approved links</h2></div><span className="muted">mapping only</span></div>
        <p className="muted">Only operator-approved https mappings resolve here. Identifiers that are raw URLs or redirects are rejected; nothing is proxied.</p>
        <label className="field-label">Reference identifier probe<input aria-label="Reference identifier probe" value={referenceProbe} onChange={(event) => setReferenceProbe(event.target.value)} placeholder={status.run.workflow_run_id} /></label>
        {linkMappings.length ? <ul className="plain-list">{linkMappings.map((mapping) => {
          const identifier = mapping.kind === "run" ? (referenceProbe.trim() || status.run.workflow_run_id) : mapping.kind === "trace" ? status.run.cursor.node_execution_id : (status.run.pending_operation?.operation_id ?? "");
          const resolution = resolveApprovedLink([mapping], mapping.kind, identifier);
          return <li key={mapping.id}>{resolution.status === "approved" ? <a href={resolution.url} target="_blank" rel="noreferrer noopener">{mapping.label}</a> : <span className={resolution.status === "rejected" ? "field-error" : "muted"} role={resolution.status === "rejected" ? "alert" : undefined}>{mapping.label}: {resolution.status} — {resolution.reason}</span>}</li>;
        })}</ul> : <p className="muted">No approved mappings configured in settings.</p>}
      </section>
      <section className="panel-card" aria-label="Gameplay map projection"><div className="panel-title"><div><p className="eyebrow">Adjacent read-only projection</p><h2>Gameplay map</h2></div>{mapProjection ? <StatusBadge tone={mapProjectionSupport(mapProjection).state === "available" ? "success" : mapProjectionSupport(mapProjection).state === "stale" ? "warning" : "muted"}>{mapProjectionSupport(mapProjection).state}</StatusBadge> : <StatusBadge tone="muted">not loaded</StatusBadge>}</div>
        <p className="muted">This is a different graph from the workflow. The projection is inert read-only data: no hidden topology, no inferred future outcomes, and no navigation actions are offered from it.</p>
        <label className="field-label">Approved map projection file<input type="file" accept="application/json,.json" aria-label="Map projection file" onChange={(event: ChangeEvent<HTMLInputElement>) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          void file.text().then((raw) => {
            try {
              setMapProjection(VisibleMapProjectionSchema.parse(JSON.parse(raw) as unknown));
              setMapError(undefined);
            } catch (error: unknown) {
              setMapProjection(undefined);
              setMapError(error instanceof Error ? error.message : "Map projection was rejected.");
            }
          });
        }} /></label>
        {mapError ? <p className="field-error" role="alert">{mapError}</p> : null}
        {mapProjection ? (() => { const support = mapProjectionSupport(mapProjection); const pinned = pinnedMapIdentity(mapProjection); return <div className="map-projection">
          <dl className="detail-list">
            <div><dt>Schema</dt><dd><code>{pinned.schemaVersion}</code> · <code>{pinned.projectionVersion}</code></dd></div>
            <div><dt>Generation</dt><dd>{pinned.generation}</dd></div>
            <div><dt>Instance</dt><dd>{pinned.mapInstanceId ?? "unavailable"}</dd></div>
            <div><dt>Act / scope</dt><dd>{pinned.actId ?? "—"} / {pinned.scopeId ?? "—"}</dd></div>
            <div><dt>State</dt><dd>{pinned.stateId}</dd></div>
            <div><dt>Availability</dt><dd>{mapProjection.availability} · {mapProjection.completeness}</dd></div>
            <div><dt>Freshness</dt><dd>{mapProjection.freshness}</dd></div>
            <div><dt>Position</dt><dd>{mapProjection.position.kind === "current" ? `current · ${mapProjection.position.node_id}` : mapProjection.position.kind}</dd></div>
            <div><dt>Visible graph</dt><dd>{mapProjection.nodes.length} nodes · {mapProjection.edges.length} edges</dd></div>
          </dl>
          <p className="muted" role="status">{support.message}</p>
          <p className="muted">{mapProjection.bindings.length} host navigation binding{mapProjection.bindings.length === 1 ? "" : "s"} pinned; none are exposed as actions.</p>
          <ul className="plain-list map-node-list">{mapProjection.nodes.map((node) => <li key={node.id}><code>{node.id}</code> · {node.category}{node.visited ? " · visited" : ""}</li>)}</ul>
        </div>; })() : <p className="muted">No approved map projection is loaded. Authoring and generic run inspection are unaffected.</p>}
      </section>
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
