import { useEffect, useMemo, useState } from "react";

import type { ClientMode, OwnerApiClient } from "@studio/client";
import { FixtureClient } from "@studio/client";
import { OwnerApiClient as LiveOwnerApiClient } from "@studio/client";
import { cloneDocument } from "@studio/document";
import type { DefinitionRecord, WorkflowDefinition } from "@studio/contracts";

import { StatusBadge } from "../components/StatusBadge";
import { CompatibilityView } from "../features/compatibility/CompatibilityView";
import { DesignerView } from "../features/designer/DesignerView";
import { LibraryView } from "../features/library/LibraryView";
import { ReplayView } from "../features/replay/ReplayView";
import { RunsView } from "../features/runs/RunsView";
import { fixtureDefinitions } from "../fixtures/catalog";

type View = "library" | "designer" | "runs" | "replay" | "compatibility";

export function App(): JSX.Element {
  const fixtureClient = useMemo(() => new FixtureClient(fixtureDefinitions), []);
  const liveClient = useMemo(() => new LiveOwnerApiClient(), []);
  const [mode, setMode] = useState<ClientMode>("fixture");
  const client = mode === "fixture" ? fixtureClient : liveClient;
  const [view, setView] = useState<View>("library");
  const [definitions, setDefinitions] = useState<DefinitionRecord[]>(fixtureDefinitions);
  const [loadingDefinitions, setLoadingDefinitions] = useState(false);
  const [catalogNotice, setCatalogNotice] = useState<string | undefined>();
  const [selectedDefinition, setSelectedDefinition] = useState<DefinitionRecord>(fixtureDefinitions[0]);
  const [activeDocument, setActiveDocument] = useState<WorkflowDefinition>(fixtureDefinitions[0].definition);
  const [runId, setRunId] = useState("run.fixture.1");
  const [appMessage, setAppMessage] = useState<string | undefined>();

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
        setDefinitions(fixtureDefinitions);
        setCatalogNotice("The owner returned no published definitions; showing the checked-in catalog for inspection.");
      }
    }).catch((error: unknown) => {
      if (!mounted) return;
      setDefinitions(fixtureDefinitions);
      setCatalogNotice(error instanceof Error ? `${error.message} Showing the checked-in Phase 1 catalog for inspection.` : "Live catalog is unavailable; showing the checked-in Phase 1 catalog.");
    }).finally(() => {
      if (mounted) setLoadingDefinitions(false);
    });
    return () => { mounted = false; };
  }, [client, mode]);

  const openDefinition = (definition: DefinitionRecord): void => {
    setSelectedDefinition(definition);
    setActiveDocument(cloneDocument(definition.definition));
    setView("designer");
    setAppMessage(undefined);
  };

  const createDraft = (template?: DefinitionRecord): void => {
    const base = template ?? definitions[0] ?? fixtureDefinitions[0];
    const draft = cloneDocument(base.definition);
    draft.version = `${draft.version}-draft`;
    draft.annotations = { ...(draft.annotations ?? {}), studioDraft: true, template_source: base.id, template_version: base.definition.version };
    setSelectedDefinition({ ...base, title: `${base.title} draft`, source: "draft", description: "Unsaved Studio draft with explicit adapter state." });
    setActiveDocument(draft);
    setView("designer");
    setAppMessage(undefined);
  };

  const runDocument = async (document: WorkflowDefinition): Promise<void> => {
    try {
      const result = await client.submitRun(document, "studio-inspection", "synthetic");
      setRunId(result.workflow_run_id);
      setView("runs");
      setAppMessage(`Owner accepted ${result.workflow_run_id} at revision ${result.run_revision}.`);
    } catch (error: unknown) {
      setAppMessage(error instanceof Error ? error.message : "Run submission failed.");
      setView("runs");
    }
  };

  const replayDocument = activeDocument ?? selectedDefinition.definition;

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand-block"><div className="brand-mark" aria-hidden="true">A</div><div><strong>Ascension</strong><span>Workflow Studio</span></div></div>
      <div className="mode-card"><StatusBadge tone={mode === "fixture" ? "fixture" : "live"}>{mode === "fixture" ? "Fixture mode" : "Live owner API"}</StatusBadge><p>{mode === "fixture" ? "Deterministic local projection" : "Same-origin authenticated adapter"}</p></div>
      <nav className="primary-nav" aria-label="Studio workspaces">
        <NavButton active={view === "library" || view === "designer"} icon="▦" label="Library" onClick={() => setView("library")} />
        <NavButton active={view === "runs"} icon="◌" label="Runs" onClick={() => setView("runs")} />
        <NavButton active={view === "replay"} icon="↺" label="Replay / Compare" onClick={() => setView("replay")} />
      </nav>
      <div className="nav-divider" />
      <nav className="secondary-nav" aria-label="Studio settings"><NavButton active={view === "compatibility"} icon="⚙" label="Compatibility" onClick={() => setView("compatibility")} /></nav>
      <div className="sidebar-footer"><span className="version-label">Studio phase 2</span><span className="muted">Harness remains execution authority.</span></div>
    </aside>
    <main className="main-shell">
      <header className="topbar"><div className="breadcrumbs"><span>AI-Ascension</span><span aria-hidden="true">/</span><strong>{view === "compatibility" ? "Compatibility" : view === "designer" ? selectedDefinition.title : view === "runs" ? "Runs" : view === "replay" ? "Replay" : "Library"}</strong></div><div className="topbar-actions"><span className="secure-label"><span aria-hidden="true">⌁</span> Owner-authoritative</span><button className="avatar-button" aria-label="Open settings" onClick={() => setView("compatibility")}>TW</button></div></header>
      {appMessage ? <div className="app-message" role="status"><span>{appMessage}</span><button aria-label="Dismiss message" onClick={() => setAppMessage(undefined)}>×</button></div> : null}
      <div className="content-shell">
        {view === "library" ? <LibraryView definitions={definitions} loading={loadingDefinitions} catalogNotice={catalogNotice} onOpen={openDefinition} onCreate={createDraft} /> : null}
        {view === "designer" ? <DesignerView client={client} definition={selectedDefinition} initialDocument={activeDocument} mode={mode} onBack={() => setView("library")} onRun={(document) => void runDocument(document)} /> : null}
        {view === "runs" ? <RunsView client={client} mode={mode} initialRunId={runId} onRunIdChange={setRunId} /> : null}
        {view === "replay" ? <ReplayView client={client} mode={mode} definition={replayDocument} definitions={definitions} /> : null}
        {view === "compatibility" ? <CompatibilityView mode={mode} onModeChange={setMode} liveClient={liveClient} /> : null}
      </div>
    </main>
  </div>;
}

function NavButton({ active, icon, label, onClick }: { active: boolean; icon: string; label: string; onClick: () => void }): JSX.Element {
  return <button className={`nav-button ${active ? "active" : ""}`} onClick={onClick} aria-current={active ? "page" : undefined}><span className="nav-icon" aria-hidden="true">{icon}</span><span>{label}</span>{active ? <span className="nav-active-mark" aria-hidden="true" /> : null}</button>;
}
