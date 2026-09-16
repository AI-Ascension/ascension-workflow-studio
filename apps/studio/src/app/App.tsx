import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ClientMode, OwnerApiClient, RunSubmissionOptions } from "@studio/client";
import { CapabilityGateError, ClientError, ContextServiceClient, FixtureClient, validateTargetConfiguration } from "@studio/client";
import { OwnerApiClient as LiveOwnerApiClient } from "@studio/client";
import { cloneDocument, definitionIdentityDigest, type ApprovedLinkMapping } from "@studio/document";
import type { DefinitionRecord, WorkflowDefinition } from "@studio/contracts";

import { StatusBadge } from "../components/StatusBadge";
import { CompatibilityView } from "../features/compatibility/CompatibilityView";
import { DesignerView } from "../features/designer/DesignerView";
import { LibraryView } from "../features/library/LibraryView";
import { ReplayView } from "../features/replay/ReplayView";
import { RunAdmissionPanel, createRunRequestId, selectionForTarget, targetConfigurationForSelection } from "../features/runs/RunAdmissionPanel";
import type { PendingRun, RunSelectionField, RunTargetSelection } from "../features/runs/RunAdmissionPanel";
import { RunsView } from "../features/runs/RunsView";
import { RecordingsView } from "../features/recordings/RecordingsView";
import { useRecording } from "../features/recordings/useRecording";
import { benchmarkCatalog } from "../features/benchmark/benchmark";
import { fixtureDefinitions } from "../fixtures/catalog";

const studioCatalog = benchmarkCatalog() ?? fixtureDefinitions;

type View = "library" | "designer" | "runs" | "replay" | "compatibility" | "recordings";

export function App(): JSX.Element {
  const recording = useRecording();
  const fixtureClient = useMemo(() => new FixtureClient(studioCatalog), []);
  const liveClient = useMemo(() => new LiveOwnerApiClient(), []);
  const contextClient = useMemo(() => new ContextServiceClient(), []);
  const [mode, setMode] = useState<ClientMode>("fixture");
  const client = mode === "fixture" ? fixtureClient : liveClient;
  const [view, setView] = useState<View>("library");
  const [definitions, setDefinitions] = useState<DefinitionRecord[]>(studioCatalog);
  const [loadingDefinitions, setLoadingDefinitions] = useState(false);
  const [catalogRefresh, setCatalogRefresh] = useState(0);
  const [catalogNotice, setCatalogNotice] = useState<string | undefined>();
  const [selectedDefinition, setSelectedDefinition] = useState<DefinitionRecord>(studioCatalog[0]);
  const [activeDocument, setActiveDocument] = useState<WorkflowDefinition>(studioCatalog[0].definition);
  const [runId, setRunId] = useState("run.fixture.1");
  const [appMessage, setAppMessage] = useState<string | undefined>();
  const [rawCandidateTexts, setRawCandidateTexts] = useState<Record<string, string>>({});
  const [linkMappings, setLinkMappings] = useState<ApprovedLinkMapping[]>([]);
  const [pendingRun, setPendingRun] = useState<PendingRun | undefined>();
  const pendingRunRef = useRef<PendingRun | undefined>(undefined);

  const updatePendingRun = useCallback((update: PendingRun | ((current: PendingRun) => PendingRun)): void => {
    // The ref is the synchronous source of truth so a second click cannot
    // observe an intermediate phase before React commits the state update.
    const current = pendingRunRef.current;
    if (!current) return;
    const next = typeof update === "function" ? update(current) : update;
    pendingRunRef.current = next;
    setPendingRun(next);
  }, []);

  const clearPendingRun = useCallback((): void => {
    pendingRunRef.current = undefined;
    setPendingRun(undefined);
  }, []);

  const rememberRawCandidate = useCallback((definitionId: string, value: string): void => {
    setRawCandidateTexts((current) => current[definitionId] === value ? current : { ...current, [definitionId]: value });
  }, []);

  useEffect(() => {
    let mounted = true;
    setLoadingDefinitions(true);
    setCatalogNotice(undefined);
    void client.listDefinitions().then((records) => {
      if (!mounted) return;
      if (records.length > 0) {
        setDefinitions(records);
        setSelectedDefinition(records[0]);
        setActiveDocument(records[0].definition);
      } else if (mode === "live") {
        setDefinitions(studioCatalog);
        setCatalogNotice("The owner returned no published definitions; showing the checked-in catalog for inspection.");
      }
    }).catch((error: unknown) => {
      if (!mounted) return;
      setDefinitions(studioCatalog);
      setCatalogNotice(error instanceof Error ? `${error.message} Showing the checked-in Phase 1 catalog for inspection.` : "Live catalog is unavailable; showing the checked-in Phase 1 catalog.");
    }).finally(() => {
      if (mounted) setLoadingDefinitions(false);
    });
    return () => { mounted = false; };
  }, [catalogRefresh, client, mode]);

  const openDefinition = (definition: DefinitionRecord): void => {
    setSelectedDefinition(definition);
    setActiveDocument(cloneDocument(definition.definition));
    setView("designer");
    setAppMessage(undefined);
  };

  const createDraft = (template?: DefinitionRecord): void => {
    const base = template ?? definitions[0] ?? studioCatalog[0];
    const draft = cloneDocument(base.definition);
    // The owner admits only `summary` and `synthetic` in annotations, so the
    // template provenance is recorded in the summary text; the pinned
    // version/digest are shown on the library card.
    draft.annotations = {
      summary: `Studio draft cloned from ${base.source}:${base.id}@${base.definition.version}${base.definitionDigest ? ` digest ${base.definitionDigest}` : ""}`,
      synthetic: true,
    };
    setSelectedDefinition({ ...base, title: `${base.title} draft`, source: "draft", description: "Unsaved Studio draft with explicit adapter state." });
    setActiveDocument(draft);
    setView("designer");
    setAppMessage(undefined);
  };

  const runDocument = (document: WorkflowDefinition): void => {
    // A pending request owns its identity from target selection through
    // preflight and submit. A second click cannot create another request.
    const current = pendingRunRef.current;
    if (current && !["error", "preflight_unknown"].includes(current.phase)) return;
    const requestId = createRunRequestId();
    const initial: PendingRun = {
      document: cloneDocument(document),
      requestId,
      phase: "loading",
      liveConfirmed: false,
    };
    pendingRunRef.current = initial;
    setPendingRun(initial);
    // Keep the current view while the operator reviews admission. Switching to
    // the run inspector now would mount it with a stale run id before the owner
    // returns the admitted run identity.
    void (async () => {
      try {
        const [catalog, digest] = await Promise.all([client.listTargets(), definitionIdentityDigest(document)]);
        if (pendingRunRef.current?.requestId !== requestId) return;
        const hasAvailable = catalog.targets.some((candidate) => candidate.availability === "available");
        updatePendingRun((candidate) => ({
          ...candidate,
          catalog,
          digest,
          selection: undefined,
          phase: hasAvailable ? "ready" : "error",
          message: hasAvailable
            ? "Select an available target and its exact profiles, then run preflight. No target is chosen automatically."
            : "No available owner target can admit this workflow.",
        }));
      } catch (error: unknown) {
        if (pendingRunRef.current?.requestId !== requestId) return;
        updatePendingRun((candidate) => ({
          ...candidate,
          phase: "error",
          message: error instanceof Error ? error.message : "Target catalog is unavailable.",
        }));
      }
    })();
  };

  const preflightPendingRun = async (): Promise<void> => {
    const current = pendingRunRef.current;
    if (!current || !current.catalog || !current.selection || !current.digest || current.phase !== "ready") return;
    const descriptor = current.catalog.targets.find((candidate) => candidate.instance_id === current.selection?.targetId);
    if (!descriptor) {
      updatePendingRun((candidate) => ({ ...candidate, phase: "error", message: "Select an available target before preflight." }));
      return;
    }
    const target = targetConfigurationForSelection(descriptor, current.selection, current.document);
    try {
      validateTargetConfiguration(descriptor, target);
      updatePendingRun((candidate) => ({ ...candidate, phase: "preflighting", message: "Owner is checking the selected target and profiles…" }));
      const result = await client.preflightTarget({
        schema_version: "ascension.workflow-admission/v1",
        request_id: current.requestId,
        workflow_definition_digest: current.digest,
        target,
      });
      if (pendingRunRef.current?.requestId !== current.requestId) return;
      updatePendingRun((candidate) => ({
        ...candidate,
        admission: result.admission,
        phase: "admitted",
        message: "Preflight succeeded. Review the owner binding before starting the run.",
      }));
    } catch (error: unknown) {
      if (pendingRunRef.current?.requestId !== current.requestId) return;
      const unknown = !(error instanceof ClientError && typeof error.status === "number" && error.status < 500)
        && !(error instanceof CapabilityGateError);
      updatePendingRun((candidate) => ({
        ...candidate,
        phase: unknown ? "preflight_unknown" : "error",
        message: error instanceof Error ? error.message : "Target preflight failed.",
      }));
    }
  };

  const submitPendingRun = async (): Promise<void> => {
    const current = pendingRunRef.current;
    if (!current || !current.selection || !current.admission || current.phase !== "admitted") return;
    if (current.admission.target.execution_mode === "live" && !current.liveConfirmed) {
      updatePendingRun((candidate) => ({ ...candidate, message: "Explicit live confirmation is required before starting this run." }));
      return;
    }
    const descriptor = current.catalog?.targets.find((candidate) => candidate.instance_id === current.selection?.targetId);
    if (!descriptor) {
      updatePendingRun((candidate) => ({ ...candidate, phase: "error", message: "The selected target is no longer in the loaded catalog." }));
      return;
    }
    const target = targetConfigurationForSelection(descriptor, current.selection, current.document);
    try {
      validateTargetConfiguration(descriptor, target);
      updatePendingRun((candidate) => ({ ...candidate, phase: "submitting", message: "Submitting the exact owner admission…" }));
      const options: RunSubmissionOptions = {
        requestId: current.requestId,
        admission: current.admission,
        target,
      };
      const result = await client.submitRun(current.document, target.instance_id, target.execution_profile, options);
      if (pendingRunRef.current?.requestId !== current.requestId) return;
      clearPendingRun();
      setRunId(result.workflow_run_id);
      setView("runs");
      setAppMessage(`Owner accepted ${result.workflow_run_id} at revision ${result.run_revision}.`);
    } catch (error: unknown) {
      if (pendingRunRef.current?.requestId !== current.requestId) return;
      const unknown = !(error instanceof ClientError && typeof error.status === "number" && error.status < 500)
        && !(error instanceof CapabilityGateError);
      updatePendingRun((candidate) => ({
        ...candidate,
        phase: unknown ? "unknown" : "error",
        message: unknown
          ? `${error instanceof Error ? error.message : "No response from the owner."} The run may have been admitted; retrying keeps request ${candidate.requestId}.`
          : error instanceof Error ? error.message : "Run submission failed.",
      }));
    }
  };

  const retryPendingRun = async (): Promise<void> => {
    const current = pendingRunRef.current;
    if (!current) return;
    if (current.phase === "preflight_unknown") {
      updatePendingRun((candidate) => ({ ...candidate, phase: "ready", message: "Retrying the same target preflight request…" }));
      // The state update above is intentionally not used as input: the ref
      // still carries the exact request identity and reviewed fields.
      await preflightPendingRun();
      return;
    }
    if (current.phase === "unknown") {
      updatePendingRun((candidate) => ({ ...candidate, phase: "admitted", message: "Retrying the same run request; the owner will deduplicate it." }));
      await submitPendingRun();
    }
  };

  /** Changing any exact target/profile field refreshes the request identity so a
   * previously issued admission can never be silently reused. */
  const resetPendingSelection = (mutate: (selection: RunTargetSelection | undefined) => RunTargetSelection | undefined): void => {
    const current = pendingRunRef.current;
    if (!current || ["submitting", "unknown"].includes(current.phase)) return;
    // Any change after an owner admission abandons that binding and must bind a
    // fresh request identity, never reuse the admitted request id.
    const identity = current.admission ? createRunRequestId() : current.requestId;
    updatePendingRun((candidate) => ({
      ...candidate,
      requestId: identity,
      selection: mutate(candidate.selection),
      admission: undefined,
      phase: "ready",
      liveConfirmed: false,
      message: "Selection changed; run preflight again before submission.",
    }));
  };

  const changePendingTarget = (targetId: string): void => {
    const current = pendingRunRef.current;
    if (!current?.catalog) return;
    const descriptor = current.catalog.targets.find((candidate) => candidate.instance_id === targetId);
    if (!descriptor) return;
    resetPendingSelection(() => selectionForTarget(descriptor));
  };

  const changePendingProfile = (field: RunSelectionField, value: string | null): void => {
    resetPendingSelection((selection) => selection ? { ...selection, [field]: value } : selection);
  };

  const retryTargetCatalog = (): void => {
    const current = pendingRunRef.current;
    if (!current) return;
    // Abandoning an admitted selection must not reuse its request id.
    const requestId = current.admission ? createRunRequestId() : current.requestId;
    updatePendingRun((candidate) => ({ ...candidate, requestId, phase: "loading", message: "Refreshing target catalog…" }));
    void client.listTargets().then((catalog) => {
      if (pendingRunRef.current?.requestId !== requestId) return;
      const hasAvailable = catalog.targets.some((candidate) => candidate.availability === "available");
      updatePendingRun((candidate) => ({
        ...candidate,
        catalog,
        selection: undefined,
        admission: undefined,
        phase: hasAvailable ? "ready" : "error",
        message: hasAvailable
          ? "Select an available target and its exact profiles, then run preflight. No target is chosen automatically."
          : "No available owner target can admit this workflow.",
      }));
    }).catch((error: unknown) => {
      if (pendingRunRef.current?.requestId !== requestId) return;
      updatePendingRun((candidate) => ({ ...candidate, phase: "error", message: error instanceof Error ? error.message : "Target catalog is unavailable." }));
    });
  };

  const replayDocument = activeDocument ?? selectedDefinition.definition;

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand-block"><div className="brand-mark" aria-hidden="true">A</div><div><strong>Ascension</strong><span>Workflow Studio</span></div></div>
      <div className="mode-card"><StatusBadge tone={view === "recordings" ? "muted" : mode === "fixture" ? "fixture" : "live"}>{view === "recordings" ? "Recorded inspection" : mode === "fixture" ? "Fixture mode" : "Live owner API"}</StatusBadge><p>{view === "recordings" ? "Local file · no execution capability" : mode === "fixture" ? "Deterministic local projection" : "Same-origin authenticated adapter"}</p></div>
      <nav className="primary-nav" aria-label="Studio workspaces">
        <NavButton active={view === "library" || view === "designer"} icon="▦" label="Library" onClick={() => setView("library")} />
        <NavButton active={view === "runs"} icon="◌" label="Runs" onClick={() => setView("runs")} />
        <NavButton active={view === "recordings"} icon="≡" label="Recorded runs" onClick={() => setView("recordings")} />
        <NavButton active={view === "replay"} icon="↺" label="Replay / Compare" onClick={() => setView("replay")} />
      </nav>
      <div className="nav-divider" />
      <nav className="secondary-nav" aria-label="Studio settings"><NavButton active={view === "compatibility"} icon="⚙" label="Compatibility" onClick={() => setView("compatibility")} /></nav>
      <div className="sidebar-footer"><span className="version-label">Studio phase 2</span><span className="muted">Harness remains execution authority.</span></div>
    </aside>
    <main className="main-shell">
      <header className="topbar"><div className="breadcrumbs"><span>AI-Ascension</span><span aria-hidden="true">/</span><strong>{view === "recordings" ? "Recorded runs" : view === "compatibility" ? "Compatibility" : view === "designer" ? selectedDefinition.title : view === "runs" ? "Runs" : view === "replay" ? "Replay" : "Library"}</strong></div><div className="topbar-actions"><span className="secure-label"><span aria-hidden="true">⌁</span> {view === "recordings" ? "Read-only inspection" : "Owner-authoritative"}</span><button className="avatar-button" aria-label="Open settings" onClick={() => setView("compatibility")}>TW</button></div></header>
      {appMessage ? <div className="app-message" role="status"><span>{appMessage}</span><button aria-label="Dismiss message" onClick={() => setAppMessage(undefined)}>×</button></div> : null}
      <div className="content-shell">
        {pendingRun ? <RunAdmissionPanel pending={pendingRun} onCancel={clearPendingRun} onRetryCatalog={retryTargetCatalog} onPreflight={() => void preflightPendingRun()} onRetry={() => void retryPendingRun()} onSubmit={() => void submitPendingRun()} onTargetChange={changePendingTarget} onProfileChange={changePendingProfile} onLiveConfirmation={(confirmed) => updatePendingRun((current) => ({ ...current, liveConfirmed: confirmed }))} /> : null}
        {view === "recordings" ? <RecordingsView {...recording} /> : null}
        {view === "library" ? <LibraryView definitions={definitions} loading={loadingDefinitions} catalogNotice={catalogNotice} onOpen={openDefinition} onCreate={createDraft} onRefresh={() => setCatalogRefresh((current) => current + 1)} /> : null}
        {view === "designer" ? <DesignerView client={client} catalog={definitions} definition={selectedDefinition} initialDocument={activeDocument} initialRawText={rawCandidateTexts[selectedDefinition.id]} mode={mode} onBack={() => setView("library")} onRun={(document) => void runDocument(document)} onRawTextChange={rememberRawCandidate} /> : null}
        {view === "runs" ? <RunsView client={client} policyClient={mode === "live" ? liveClient : undefined} contextClient={contextClient} mode={mode} initialRunId={runId} onRunIdChange={setRunId} linkMappings={linkMappings} /> : null}
        {view === "replay" ? <ReplayView client={client} contextClient={contextClient} mode={mode} definition={replayDocument} definitions={definitions} /> : null}
        {view === "compatibility" ? <CompatibilityView mode={mode} onModeChange={setMode} liveClient={liveClient} linkMappings={linkMappings} onAddMapping={(mapping) => setLinkMappings((current) => [...current.filter((candidate) => candidate.id !== mapping.id), mapping])} onRemoveMapping={(id) => setLinkMappings((current) => current.filter((candidate) => candidate.id !== id))} /> : null}
      </div>
    </main>
  </div>;
}

function NavButton({ active, icon, label, onClick }: { active: boolean; icon: string; label: string; onClick: () => void }): JSX.Element {
  return <button className={`nav-button ${active ? "active" : ""}`} onClick={onClick} aria-current={active ? "page" : undefined}><span className="nav-icon" aria-hidden="true">{icon}</span><span>{label}</span>{active ? <span className="nav-active-mark" aria-hidden="true" /> : null}</button>;
}
