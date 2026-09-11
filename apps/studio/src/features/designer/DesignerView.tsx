import {
  type ChangeEvent,
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  applyNodeChanges,
  type Connection,
  type Edge,
  type Node,
  type NodeChange,
} from "@xyflow/react";

import {
  JsonObjectSchema,
  LayoutSidecarSchema,
  type DefinitionRecord,
  type DraftRecord,
  type LayoutSidecar,
  type ValidateResponse,
  type WorkflowDefinition,
  type WorkflowNode,
} from "@studio/contracts";
import { CapabilityGateError, type StudioClient } from "@studio/client";
import {
  History,
  alignLayout,
  addEdge,
  addNode,
  cloneDocument,
  copyNodes,
  createFlowProjection,
  createLayout,
  diffDocuments,
  layoutIsValid,
  mergeDocuments,
  parseBoundedJson,
  parseDefinitionImport,
  removeNode,
  reconnectEdge,
  parseStudioBundle,
  pasteNodes,
  qualifiedNodeId,
  serializeStudioBundle,
  updateLayout,
  updateNode,
  type NodeClipboard,
  type SemanticDocument,
  type StudioFlowNode,
} from "@studio/document";

import { Notice } from "../../components/Notice";
import { StatusBadge } from "../../components/StatusBadge";

type FlowData = StudioFlowNode["data"];
type FlowNode = Node<FlowData>;
type EditorTab = "canvas" | "list";

interface DesignerViewProps {
  client: StudioClient;
  definition: DefinitionRecord;
  initialDocument: WorkflowDefinition;
  initialRawText?: string;
  mode: "fixture" | "live";
  onBack: () => void;
  onRun: (document: WorkflowDefinition) => void;
  onRawTextChange: (definitionId: string, value: string) => void;
}

interface DraftState {
  revision: number;
  etag: string;
  state: "saved" | "saving" | "offline" | "conflict";
  message: string;
  server?: DraftRecord;
}

interface ArchivalImport {
  schemaVersion: string;
  rawText: string;
  reason: string;
}

interface EditorSnapshot {
  document: SemanticDocument;
  layout: LayoutSidecar;
}

function copyEditorSnapshot(snapshot: EditorSnapshot): EditorSnapshot {
  return {
    document: cloneDocument(snapshot.document),
    layout: LayoutSidecarSchema.parse(JSON.parse(JSON.stringify(snapshot.layout)) as unknown),
  };
}

export function DesignerView({ client, definition, initialDocument, initialRawText, mode, onBack, onRun, onRawTextChange }: DesignerViewProps): JSX.Element {
  const [document, setDocument] = useState<SemanticDocument>(() => initialDocument);
  const [layout, setLayout] = useState<LayoutSidecar>(() => createLayout(initialDocument, "pending"));
  const [nodes, setNodes] = useState<FlowNode[]>(() => toFlowNodes(initialDocument, createLayout(initialDocument, "pending")));
  const [tab, setTab] = useState<EditorTab>("canvas");
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedEdge, setSelectedEdge] = useState<{ graphId: string; edgeIndex: number } | undefined>();
  const [clipboard, setClipboard] = useState<NodeClipboard | undefined>();
  const [rawMode, setRawMode] = useState(false);
  const [rawText, setRawText] = useState(() => initialRawText ?? JSON.stringify(initialDocument, null, 2));
  const [rawError, setRawError] = useState<string | undefined>();
  const [archivalImport, setArchivalImport] = useState<ArchivalImport | undefined>();
  const [bundlePreview, setBundlePreview] = useState<string | undefined>();
  const [diagnostics, setDiagnostics] = useState<ValidateResponse | undefined>();
  const [validationState, setValidationState] = useState<"idle" | "running" | "valid" | "invalid" | "error">("idle");
  const [validationMessage, setValidationMessage] = useState("");
  const [draft, setDraft] = useState<DraftState>({ revision: 0, etag: "fixture-0", state: "saved", message: "Draft changes are local until autosave completes." });
  const [draftHydrated, setDraftHydrated] = useState(false);
  const [publicationState, setPublicationState] = useState<"idle" | "publishing">("idle");
  const draftRef = useRef(draft);
  const persistedKeyRef = useRef<string | undefined>(undefined);
  const mutationIdsRef = useRef(new Map<string, string>());
  const publicationIdsRef = useRef(new Map<string, string>());
  const saveGenerationRef = useRef(0);
  const history = useRef(new History<EditorSnapshot>(
    { document: initialDocument, layout: createLayout(initialDocument, "pending") },
    copyEditorSnapshot,
  ));
  const bundleInput = useRef<HTMLInputElement>(null);

  draftRef.current = draft;

  const draftId = `draft.${definition.id}`;

  const valueKey = (nextDocument: SemanticDocument, nextLayout: LayoutSidecar): string => JSON.stringify({ document: nextDocument, layout: nextLayout });

  useEffect(() => {
    const nextLayout = createLayout(initialDocument, "pending");
    history.current = new History<EditorSnapshot>({ document: initialDocument, layout: nextLayout }, copyEditorSnapshot);
    setDocument(initialDocument);
    setLayout(nextLayout);
    setNodes(toFlowNodes(initialDocument, nextLayout));
    setSelectedId(undefined);
    setSelectedIds([]);
    setSelectedEdge(undefined);
    setRawText(initialRawText ?? JSON.stringify(initialDocument, null, 2));
    setRawError(undefined);
    setArchivalImport(undefined);
    setDiagnostics(undefined);
    setValidationState("idle");
    setDraftHydrated(false);
    persistedKeyRef.current = undefined;
    setDraft({ revision: 0, etag: "fixture-0", state: "saved", message: "Draft changes are local until autosave completes." });
  }, [initialDocument]);

  useEffect(() => {
    let active = true;
    const loadDraft = async (): Promise<void> => {
      try {
        const saved = await client.getDraft(draftId);
        if (!active) return;
        if (saved) {
          const parsedLayout = LayoutSidecarSchema.safeParse(saved.layout);
          const nextLayout = parsedLayout.success ? parsedLayout.data : createLayout(saved.document, "pending");
          history.current = new History<EditorSnapshot>({ document: saved.document, layout: nextLayout }, copyEditorSnapshot);
          setDocument(saved.document);
          setLayout(nextLayout);
          setNodes(toFlowNodes(saved.document, nextLayout));
          if (!initialRawText) setRawText(JSON.stringify(saved.document, null, 2));
          setDraft({ revision: saved.revision, etag: saved.etag, state: saved.conflict ? "conflict" : "saved", message: saved.conflict ? "The owner returned a persisted draft conflict." : "Loaded the owner-backed draft.", server: saved.conflict ? saved : undefined });
          persistedKeyRef.current = valueKey(saved.document, nextLayout);
        }
      } catch (error: unknown) {
        if (active && !(error instanceof CapabilityGateError)) {
          setDraft((current) => ({ ...current, state: "offline", message: error instanceof Error ? error.message : "Draft load failed." }));
        }
      } finally {
        if (active) setDraftHydrated(true);
      }
    };
    void loadDraft();
    return () => { active = false; };
  }, [client, draftId]);

  useEffect(() => {
    if (!draftHydrated || draftRef.current.state === "conflict") return;
    const currentDraft = draftRef.current;
    const currentKey = valueKey(document, layout);
    if (persistedKeyRef.current === currentKey) return;
    const mutationKey = JSON.stringify({ draftId, currentDraft: { revision: currentDraft.revision, etag: currentDraft.etag }, value: currentKey });
    const clientMutationId = mutationIdsRef.current.get(mutationKey) ?? `studio.mutation.${Date.now()}.${mutationIdsRef.current.size}`;
    mutationIdsRef.current.set(mutationKey, clientMutationId);
    const generation = saveGenerationRef.current + 1;
    saveGenerationRef.current = generation;
    const timer = window.setTimeout(() => {
      setDraft((current) => ({ ...current, state: "saving", message: "Saving draft through the owner adapter…" }));
      void client.saveDraft({
        draftId,
        definitionId: definition.id,
        revision: currentDraft.revision,
        etag: currentDraft.etag,
        document,
        layout,
        clientMutationId,
      }).then((saved) => {
        if (generation !== saveGenerationRef.current) return;
        persistedKeyRef.current = currentKey;
        setDraft({ revision: saved.revision, etag: saved.etag, state: saved.conflict ? "conflict" : "saved", message: saved.conflict ? "The owner reported a revision conflict." : "Autosaved to the active adapter.", server: saved.conflict ? saved : undefined });
      }).catch((error: unknown) => {
        if (generation !== saveGenerationRef.current) return;
        if (error instanceof CapabilityGateError) {
          setDraft((current) => ({ ...current, state: "offline", message: "Draft persistence is unavailable through the active owner adapter." }));
        } else {
          setDraft((current) => ({ ...current, state: "offline", message: error instanceof Error ? error.message : "Draft save failed." }));
        }
      });
    }, 700);
    return () => window.clearTimeout(timer);
  }, [client, definition.id, draftHydrated, document, layout, draftId]);

  const selected = useMemo(() => findSelectedNode(document, selectedId), [document, selectedId]);
  const flowEdges = useMemo(() => toFlowEdges(document), [document]);

  const ensureLayout = useCallback((nextDocument: SemanticDocument, currentLayout: LayoutSidecar): LayoutSidecar => {
    const next = { ...currentLayout.positions };
    const existing = new Set(Object.keys(next));
    const projection = createFlowProjection({ semantic: nextDocument, layout: currentLayout });
    projection.nodes.forEach((node, index) => {
      if (!existing.has(node.id)) {
        next[node.id] = { x: 92 + (index % 4) * 248, y: 96 + Math.floor(index / 4) * 168 };
      }
    });
    return { ...currentLayout, positions: next };
  }, []);

  const commit = useCallback((nextDocument: SemanticDocument): void => {
    const nextLayout = { ...ensureLayout(nextDocument, layout), semanticDigest: "pending" } as LayoutSidecar;
    history.current.commit({ document: nextDocument, layout: nextLayout });
    setDocument(nextDocument);
    setLayout(nextLayout);
    setNodes(toFlowNodes(nextDocument, nextLayout));
    const nextRawText = JSON.stringify(nextDocument, null, 2);
    setRawText(nextRawText);
    onRawTextChange(definition.id, nextRawText);
    setRawError(undefined);
    setArchivalImport(undefined);
    setDiagnostics(undefined);
    setValidationState("idle");
  }, [definition.id, ensureLayout, layout, onRawTextChange]);

  const undo = (): void => {
    const next = history.current.undo();
    setDocument(next.document);
    setLayout(next.layout);
    setNodes(toFlowNodes(next.document, next.layout));
    setRawText(JSON.stringify(next.document, null, 2));
    setRawError(undefined);
  };

  const redo = (): void => {
    const next = history.current.redo();
    setDocument(next.document);
    setLayout(next.layout);
    setNodes(toFlowNodes(next.document, next.layout));
    setRawText(JSON.stringify(next.document, null, 2));
    setRawError(undefined);
  };

  const selectNode = useCallback((id: string, additive = false): void => {
    setSelectedId(id);
    setSelectedEdge(undefined);
    setSelectedIds((current) => {
      const next = additive ? (current.includes(id) ? current.filter((candidate) => candidate !== id) : [...current, id]) : [id];
      setNodes((currentNodes) => currentNodes.map((node) => ({ ...node, selected: next.includes(node.id) })));
      return next;
    });
  }, []);

  const copySelection = (): void => {
    try {
      const ids = selectedIds.length > 0 ? selectedIds : selectedId ? [selectedId] : [];
      setClipboard(copyNodes(document, ids));
      setValidationState("valid");
      setValidationMessage(`Copied ${ids.length} node${ids.length === 1 ? "" : "s"} with internal edges.`);
    } catch (error: unknown) {
      setValidationState("error");
      setValidationMessage(error instanceof Error ? error.message : "Nothing could be copied.");
    }
  };

  const pasteSelection = (): void => {
    if (!clipboard) return;
    try {
      const graphId = findSelectedNode(document, selectedId)?.graphId ?? document.entry_graph;
      const pasted = pasteNodes(document, graphId, clipboard);
      commit(pasted.document);
      setSelectedIds(pasted.selectedIds);
      setSelectedId(pasted.selectedIds.at(-1));
      setValidationState("valid");
      setValidationMessage(`Pasted ${pasted.selectedIds.length} remapped node${pasted.selectedIds.length === 1 ? "" : "s"}.`);
    } catch (error: unknown) {
      setValidationState("error");
      setValidationMessage(error instanceof Error ? error.message : "Paste was rejected.");
    }
  };

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || !(event.ctrlKey || event.metaKey) || isEditableShortcutTarget(event.target)) return;
      const key = event.key.toLowerCase();
      if (key === "z") {
        event.preventDefault();
        if (event.shiftKey) redo(); else undo();
      } else if (key === "y") {
        event.preventDefault();
        redo();
      } else if (key === "c") {
        event.preventDefault();
        copySelection();
      } else if (key === "v") {
        event.preventDefault();
        pasteSelection();
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  });

  const alignSelection = (): void => {
    try {
      const nextLayout = alignLayout(layout, selectedIds, "x");
      history.current.commit({ document, layout: nextLayout });
      setLayout(nextLayout);
      setNodes(toFlowNodes(document, nextLayout));
      setValidationState("valid");
      setValidationMessage("Aligned the selected nodes without changing semantic execution.");
    } catch (error: unknown) {
      setValidationState("error");
      setValidationMessage(error instanceof Error ? error.message : "Alignment was rejected.");
    }
  };

  const applyRawDefinition = (): void => {
    try {
      const imported = parseDefinitionImport(rawText);
      if (imported.kind === "archival") {
        setArchivalImport(imported);
        setValidationState("error");
        setValidationMessage("Future-schema content is retained read-only and cannot be submitted.");
        return;
      }
      commit(imported.document);
      setValidationState("valid");
      setValidationMessage("Applied the bounded canonical JSON definition as a new semantic candidate.");
    } catch (error: unknown) {
      setRawError(error instanceof Error ? error.message : "Definition JSON was rejected.");
      setValidationState("error");
    }
  };

  const onNodesChange = (changes: NodeChange<FlowNode>[]): void => {
    const nextNodes = applyNodeChanges(changes, nodes);
    setNodes(nextNodes);
    const positions: Record<string, { x: number; y: number }> = {};
    for (const node of nextNodes) {
      positions[node.id] = node.position;
    }
    setLayout((current) => updateLayout(current, positions));
  };

  const onConnect = (connection: Connection): void => {
    if (!connection.source || !connection.target) return;
    const source = splitQualifiedId(connection.source);
    const target = splitQualifiedId(connection.target);
    if (!source || !target || source.graphId !== target.graphId) return;
    try {
      commit(addEdge(document, source.graphId, { from: source.nodeId, to: target.nodeId, on: "ok", priority: 0 }));
    } catch (error: unknown) {
      setValidationMessage(error instanceof Error ? error.message : "Connection was rejected.");
      setValidationState("error");
    }
  };

  const onEdgeClick = (_event: ReactMouseEvent, edge: Edge): void => {
    const located = locateEdge(document, edge.id);
    if (!located) return;
    setSelectedEdge(located);
    setSelectedIds([]);
    setSelectedId(undefined);
  };

  const applyReconnect = (from: string, to: string): void => {
    if (!selectedEdge) return;
    try {
      commit(reconnectEdge(document, selectedEdge.graphId, selectedEdge.edgeIndex, from, to));
      setValidationState("valid");
      setValidationMessage("Reconnected the guarded edge as a semantic edit.");
    } catch (error: unknown) {
      setValidationState("error");
      setValidationMessage(error instanceof Error ? error.message : "Reconnection was rejected.");
    }
  };

  const validate = async (): Promise<void> => {
    setValidationState("running");
    setValidationMessage("");
    try {
      const result = await client.validate(document);
      setDiagnostics(result);
      setValidationState(result.valid ? "valid" : "invalid");
      setValidationMessage(result.valid ? `Validated at ${result.definition_digest.slice(0, 12)}…` : `${result.diagnostics.length} diagnostic${result.diagnostics.length === 1 ? "" : "s"} reported.`);
      setLayout((current) => ({ ...current, semanticDigest: result.definition_digest }));
    } catch (error: unknown) {
      setValidationState("error");
      setValidationMessage(error instanceof Error ? error.message : "Validation failed.");
    }
  };

  const publish = async (): Promise<void> => {
    if (draft.state !== "saved") {
      setValidationState("error");
      setValidationMessage("Wait for the draft to reach a saved revision before publishing.");
      return;
    }
    setPublicationState("publishing");
    setValidationState("running");
    setValidationMessage("");
    try {
      const validation = await client.validate(document);
      setDiagnostics(validation);
      if (!validation.valid) {
        setValidationState("invalid");
        setValidationMessage("Publication was blocked by owner validation diagnostics.");
        return;
      }
      const publishKey = `${draft.revision}:${draft.etag}:${validation.definition_digest}`;
      const clientMutationId = publicationIdsRef.current.get(publishKey) ?? `studio.publish.${Date.now()}.${publicationIdsRef.current.size}`;
      publicationIdsRef.current.set(publishKey, clientMutationId);
      const result = await client.publishDraft(draftId, draft.revision, draft.etag, validation.definition_digest, clientMutationId);
      if (result.outcome === "conflict" && result.draft) {
        setDraft({ revision: result.draft.revision, etag: result.draft.etag, state: "conflict", message: "The owner returned a publication conflict.", server: result.draft });
        setValidationState("error");
        setValidationMessage("Publication needs conflict resolution before it can create an immutable revision.");
      } else {
        setValidationState("valid");
        setValidationMessage(result.outcome === "already_published" ? "This exact semantic digest is already published." : "Published an immutable owner revision.");
      }
    } catch (error: unknown) {
      setValidationState("error");
      setValidationMessage(error instanceof Error ? error.message : "Publication failed.");
    } finally {
      setPublicationState("idle");
    }
  };

  const addNewNode = (): void => {
    const graph = document.graphs[0];
    if (!graph) return;
    const id = nextNodeId(graph.nodes.map((node) => node.id));
    const node: WorkflowNode = { id, kind: "observe", config: { projection_ref: "studio.new" } };
    commit(addNode(document, graph.id, node));
    selectNode(`${graph.id}:${id}`);
  };

  const exportBundle = async (): Promise<void> => {
    try {
      const raw = await serializeStudioBundle({ semantic: document, layout });
      setBundlePreview(raw.slice(0, 2_000));
      const url = URL.createObjectURL(new Blob([raw], { type: "application/json" }));
      const link = window.document.createElement("a");
      link.href = url;
      link.download = `${document.workflow_id.replaceAll(/[^A-Za-z0-9._-]/g, "_")}.studio.json`;
      link.click();
      URL.revokeObjectURL(url);
      setValidationState("valid");
      setValidationMessage("Exported a digest-bound Studio bundle.");
    } catch (error: unknown) {
      setValidationState("error");
      setValidationMessage(error instanceof Error ? error.message : "Bundle export failed.");
    }
  };

  const importBundle = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const raw = await file.text();
    try {
      const bundle = await parseStudioBundle(raw);
      history.current = new History<EditorSnapshot>({ document: bundle.semantic, layout: bundle.layout }, copyEditorSnapshot);
      setDocument(bundle.semantic);
      setLayout(bundle.layout);
      setNodes(toFlowNodes(bundle.semantic, bundle.layout));
      setSelectedId(undefined);
      setSelectedIds([]);
      setSelectedEdge(undefined);
      setRawText(JSON.stringify(bundle.semantic, null, 2));
      setArchivalImport(undefined);
      setDiagnostics(undefined);
      setValidationState("valid");
      setValidationMessage("Imported and verified a digest-bound Studio bundle.");
    } catch (error: unknown) {
      try {
        const imported = parseDefinitionImport(raw);
        if (imported.kind === "archival") {
          setArchivalImport(imported);
          setValidationState("error");
          setValidationMessage("Future-schema content was retained in read-only archival mode.");
        } else {
          commit(imported.document);
          setValidationState("valid");
          setValidationMessage("Imported a supported owner definition; validation is still required before use.");
        }
      } catch {
        setValidationState("error");
        setValidationMessage(error instanceof Error ? error.message : "Bundle import failed.");
      }
    }
  };

  const updateSelected = (update: (node: WorkflowNode) => WorkflowNode): void => {
    if (!selected || selected.node.kind === "adaptive_region") return;
    commit(updateNode(document, selected.graphId, selected.node.id, update));
  };

  const removeSelected = (): void => {
    if (!selected || selected.node.kind === "adaptive_region") return;
    try {
      commit(removeNode(document, selected.graphId, selected.node.id));
      setSelectedId(undefined);
      setSelectedIds((current) => current.filter((id) => id !== selectedId));
    } catch (error: unknown) {
      setValidationMessage(error instanceof Error ? error.message : "Node could not be removed.");
      setValidationState("error");
    }
  };

  const keepRemoteConflict = (): void => {
    const remote = draft.server?.conflict?.serverDocument;
    if (!remote || !draft.server) return;
    const remoteLayoutResult = LayoutSidecarSchema.safeParse(draft.server.conflict?.serverLayout ?? draft.server.layout);
    const remoteLayout = remoteLayoutResult.success ? remoteLayoutResult.data : createLayout(remote, "pending");
    history.current = new History<EditorSnapshot>({ document: remote, layout: remoteLayout }, copyEditorSnapshot);
    setDocument(remote);
    setLayout(remoteLayout);
    setNodes(toFlowNodes(remote, remoteLayout));
    setRawText(JSON.stringify(remote, null, 2));
    persistedKeyRef.current = valueKey(remote, remoteLayout);
    setDraft({ revision: draft.server.revision, etag: draft.server.etag, state: "saved", message: "Remote revision loaded; local conflict was discarded." });
  };

  const saveLocalAsNew = async (): Promise<void> => {
    try {
      const saved = await client.saveDraft({ draftId: `draft.${definition.id}.copy.${Date.now()}`, definitionId: definition.id, revision: 0, etag: "fixture-0", document, layout, clientMutationId: `studio.copy.${Date.now()}` });
      setDraft({ revision: saved.revision, etag: saved.etag, state: "saved", message: "Local candidate was saved as a new draft." });
    } catch (error: unknown) {
      setDraft((current) => ({ ...current, state: "offline", message: error instanceof Error ? error.message : "Could not save a new draft." }));
    }
  };

  const mergeConflict = (): void => {
    const remote = draft.server?.conflict?.serverDocument;
    if (!remote) return;
    const result = mergeDocuments(initialDocument, document, remote);
    if (result.conflicts.length > 0 || !result.document) {
      setValidationState("error");
      setValidationMessage(`Merge needs review at ${result.conflicts.map((conflict) => conflict.path).join(", ")}.`);
      return;
    }
    commit(result.document);
    setDraft({ revision: draft.server?.revision ?? draft.revision, etag: draft.server?.etag ?? draft.etag, state: "saved", message: "Non-overlapping semantic changes were merged; validation is required again." });
  };

  const selectedConfigText = selected ? JSON.stringify(selected.node.config, null, 2) : "";
  const layoutState = layoutIsValid(document, layout) ? "bound" : "repair needed";

  return <section className="view-stack designer-view" aria-labelledby="designer-title">
    <div className="view-heading compact-heading">
      <div>
        <button className="back-link" onClick={onBack}>← Library</button>
        <div className="heading-line"><p className="eyebrow">Workspace / Designer</p><StatusBadge tone={mode === "fixture" ? "fixture" : "live"}>{mode === "fixture" ? "fixture adapter" : "live API"}</StatusBadge></div>
        <h1 id="designer-title">{definition.title}</h1>
        <p className="lede"><code>{document.workflow_id}@{document.version}</code> · Semantic document and layout sidecar stay separate.</p>
      </div>
      <div className="heading-actions">
        <StatusBadge tone={draft.state === "saved" ? "success" : draft.state === "conflict" ? "danger" : "warning"}>{draft.state}</StatusBadge>
        <button className="button button-secondary" onClick={() => void validate()} disabled={validationState === "running" || publicationState === "publishing"}>◈ Validate</button>
        <button className="button button-primary" onClick={() => void publish()} disabled={publicationState === "publishing" || draft.state !== "saved"}>{publicationState === "publishing" ? "Publishing…" : "Publish revision"}</button>
        <button className="button button-primary" onClick={() => onRun(document)}>Run inspection</button>
      </div>
    </div>
    <div className="designer-status-row">
      <span className="muted">Layout binding: <strong>{layoutState}</strong></span>
      <span className="muted">{draft.message}</span>
      {validationMessage ? <span className={`validation-label validation-${validationState}`}>{validationMessage}</span> : null}
    </div>
    {draft.state === "conflict" ? <Notice tone="danger" title="Draft conflict">The server revision changed while this editor was saving. Review the conflict before publishing.</Notice> : null}
    {draft.state === "conflict" && draft.server ? <ConflictPanel base={initialDocument} local={document} remote={draft.server.conflict?.serverDocument ?? draft.server.document} onKeepRemote={keepRemoteConflict} onKeepLocal={saveLocalAsNew} onMerge={mergeConflict} /> : null}
    <div className="designer-toolbar" role="toolbar" aria-label="Designer tools">
      <div className="segmented-control" role="tablist" aria-label="Editor surface">
        <button className={tab === "canvas" ? "active" : ""} onClick={() => setTab("canvas")} role="tab" aria-selected={tab === "canvas"}>Canvas</button>
        <button className={tab === "list" ? "active" : ""} onClick={() => setTab("list")} role="tab" aria-selected={tab === "list"}>List editor</button>
      </div>
      <div className="toolbar-actions">
        <button className="button button-quiet" onClick={undo} disabled={!history.current.canUndo()}>Undo</button>
        <button className="button button-quiet" onClick={redo} disabled={!history.current.canRedo()}>Redo</button>
        <button className="button button-secondary" onClick={addNewNode}>＋ Node</button>
        <button className="button button-quiet" onClick={copySelection} disabled={selectedIds.length === 0 && !selectedId}>Copy</button>
        <button className="button button-quiet" onClick={pasteSelection} disabled={!clipboard}>Paste</button>
        <button className="button button-quiet" onClick={alignSelection} disabled={selectedIds.length < 2}>Align X</button>
        <button className={`button ${rawMode ? "button-secondary" : "button-quiet"}`} onClick={() => setRawMode((current) => !current)}>{rawMode ? "Close JSON" : "JSON mode"}</button>
        <button className="button button-quiet" onClick={() => void exportBundle()}>Export</button>
        <button className="button button-quiet" onClick={() => bundleInput.current?.click()}>Import</button>
        <input ref={bundleInput} className="sr-only" type="file" accept="application/json,.json" onChange={(event) => void importBundle(event)} />
      </div>
    </div>
    <DefinitionControls document={document} onCommit={commit} />
    {rawMode ? <RawDefinitionPanel rawText={rawText} error={rawError} onChange={(value) => { setRawText(value); onRawTextChange(definition.id, value); setRawError(undefined); }} onApply={applyRawDefinition} /> : null}
    {archivalImport ? <ArchivalImportPanel archival={archivalImport} /> : null}
    {bundlePreview ? <details className="bundle-preview"><summary>Last portable bundle preview</summary><pre>{bundlePreview}
…</pre></details> : null}
    {tab === "canvas" ? <div className="designer-body">
      <div className="flow-shell" aria-label="Workflow graph canvas">
        <ReactFlow<FlowNode, Edge<{ qualifiedSource: string; qualifiedTarget: string }>>
          nodes={nodes}
          edges={flowEdges}
          onNodesChange={onNodesChange}
          onConnect={onConnect}
          onNodeClick={(event, node) => selectNode(node.id, event.metaKey || event.ctrlKey)}
          onEdgeClick={onEdgeClick}
          onNodeDragStop={(_event, node) => {
            const nextLayout = updateLayout(layout, { [node.id]: node.position });
            history.current.commit({ document, layout: nextLayout });
            setLayout(nextLayout);
            setNodes(toFlowNodes(document, nextLayout));
          }}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          nodesDraggable
          nodesConnectable
          deleteKeyCode={null}
          proOptions={{ hideAttribution: true }}
        >
          <Background color="#29415b" gap={24} size={1} />
          <Controls showInteractive={false} />
          <MiniMap pannable zoomable nodeColor={(node) => node.data.locked ? "#f0a45b" : "#5da8ff"} />
        </ReactFlow>
      </div>
      <div className="inspector-stack">
        <InspectorPanel selected={selected} selectedConfigText={selectedConfigText} onUpdate={updateSelected} onRemove={removeSelected} />
        {selectedEdge ? <EdgeInspector document={document} selectedEdge={selectedEdge} onReconnect={applyReconnect} /> : null}
      </div>
    </div> : <ListEditor document={document} selectedId={selectedId} selectedIds={selectedIds} onSelect={selectNode} onUpdate={updateSelected} onRemove={removeSelected} />}
    {diagnostics ? <DiagnosticsPanel result={diagnostics} onFocusPath={(path) => {
      const target = document.graphs.flatMap((graph) => graph.nodes.map((node) => ({ graphId: graph.id, nodeId: node.id }))).find((candidate) => path.includes(candidate.nodeId));
      if (target) {
        setTab("list");
        selectNode(`${target.graphId}:${target.nodeId}`);
      }
    }} /> : null}
  </section>;
}

interface SelectedNode {
  graphId: string;
  node: WorkflowNode;
}

interface InspectorPanelProps {
  selected: SelectedNode | undefined;
  selectedConfigText: string;
  onUpdate: (update: (node: WorkflowNode) => WorkflowNode) => void;
  onRemove: () => void;
}

function InspectorPanel({ selected, selectedConfigText, onUpdate, onRemove }: InspectorPanelProps): JSX.Element {
  const [configText, setConfigText] = useState(selectedConfigText);
  const [configError, setConfigError] = useState<string | undefined>();
  useEffect(() => setConfigText(selectedConfigText), [selectedConfigText]);
  if (!selected) {
    return <aside className="inspector-panel"><div className="inspector-empty"><span aria-hidden="true">◇</span><strong>Select a node</strong><p>Choose a graph node to inspect its typed fields and safe edit boundary.</p></div></aside>;
  }
  const locked = selected.node.kind === "adaptive_region";
  return <aside className="inspector-panel" aria-label="Node inspector">
    <div className="panel-title"><div><p className="eyebrow">Node inspector</p><h2>{selected.node.id}</h2></div><StatusBadge tone={locked ? "warning" : "success"}>{locked ? "read only" : selected.node.kind}</StatusBadge></div>
    <label className="field-label">Node kind
      <select value={selected.node.kind} disabled={locked} onChange={(event) => onUpdate((node) => ({ ...node, kind: event.target.value }))}>
        {nodeKinds.map((kind) => <option key={kind} value={kind}>{kind}</option>)}
      </select>
    </label>
    <TypedConfigFields node={selected.node} disabled={locked} onUpdate={onUpdate} />
    <label className="field-label">Configuration <span className="muted">JSON object</span>
      <textarea value={configText} disabled={locked} rows={12} onChange={(event) => { setConfigText(event.target.value); setConfigError(undefined); }} onBlur={() => {
        try {
          const parsed: unknown = JSON.parse(configText);
          const result = JsonObjectSchema.safeParse(parsed);
          if (result.success) {
            setConfigError(undefined);
            onUpdate((node) => ({ ...node, config: result.data }));
          } else {
            setConfigError("Configuration must be a JSON object with finite values.");
          }
        } catch {
          setConfigError("Configuration is not valid JSON; the previous value is preserved.");
        }
      }} />
    </label>
    {configError ? <p className="field-error" role="alert">{configError}</p> : null}
    {locked ? <Notice tone="warning" title="Protected adaptive region">Planner output and protected execution stay under the harness authority. This Studio can inspect the region but cannot edit its runtime plan.</Notice> : null}
    {!locked ? <button className="button button-danger-outline" onClick={onRemove}>Remove node</button> : null}
  </aside>;
}

interface TypedConfigFieldsProps {
  node: WorkflowNode;
  disabled: boolean;
  onUpdate: (update: (node: WorkflowNode) => WorkflowNode) => void;
}

function TypedConfigFields({ node, disabled, onUpdate }: TypedConfigFieldsProps): JSX.Element {
  const fields = typedFieldsByKind[node.kind] ?? [];
  return <div className="typed-config-fields" aria-label="Typed node fields">
    <p className="eyebrow">Typed fields</p>
    {fields.map((field) => <TypedConfigField key={field.key} node={node} field={field} disabled={disabled} onUpdate={onUpdate} />)}
    {fields.length === 0 ? <p className="field-unknown">No admitted typed form for this node kind. Use bounded JSON mode.</p> : null}
  </div>;
}

interface TypedConfigFieldDefinition {
  key: string;
  label: string;
  type: "text" | "number";
  min?: number;
}

function TypedConfigField({ node, field, disabled, onUpdate }: { node: WorkflowNode; field: TypedConfigFieldDefinition; disabled: boolean; onUpdate: TypedConfigFieldsProps["onUpdate"] }): JSX.Element {
  const current = node.config[field.key];
  const known = current === undefined || (field.type === "text" ? typeof current === "string" : typeof current === "number");
  const [draft, setDraft] = useState(current === undefined ? "" : String(current));
  const [error, setError] = useState<string | undefined>();
  useEffect(() => setDraft(current === undefined ? "" : String(current)), [current]);
  return <label className="field-label">{field.label}<span className="muted">{current === undefined ? "not set" : !known ? "unavailable type" : "owner field"}</span>
    <input type={field.type === "number" ? "number" : "text"} value={draft} disabled={disabled} placeholder={current === undefined ? "Unavailable until configured" : undefined} onChange={(event) => { setDraft(event.target.value); setError(undefined); }} onBlur={() => {
      if (field.type === "number") {
        const value = Number(draft);
        if (!Number.isSafeInteger(value) || (field.min !== undefined && value < field.min)) {
          setError(`Enter a safe integer${field.min === undefined ? "" : ` greater than or equal to ${field.min}`}.`);
          return;
        }
        setError(undefined);
        onUpdate((candidate) => ({ ...candidate, config: { ...candidate.config, [field.key]: value } }));
      } else {
        if (draft.length > 256) {
          setError("This field is limited to 256 characters.");
          return;
        }
        setError(undefined);
        onUpdate((candidate) => ({ ...candidate, config: { ...candidate.config, [field.key]: draft } }));
      }
    }} />
    {error ? <span className="field-error" role="alert">{error}</span> : null}
  </label>;
}

const typedFieldsByKind: Record<string, TypedConfigFieldDefinition[]> = {
  observe: [{ key: "projection_ref", label: "Projection reference", type: "text" }],
  decide: [{ key: "decision_profile_ref", label: "Decision profile", type: "text" }, { key: "context_ref", label: "Decision context", type: "text" }],
  execute_action: [{ key: "output", label: "Action output", type: "text" }],
  route: [{ key: "selector_ref", label: "Selector reference", type: "text" }],
  loop: [{ key: "body_graph", label: "Body graph", type: "text" }, { key: "max_iterations", label: "Maximum iterations", type: "number", min: 1 }, { key: "exit_guard_ref", label: "Exit guard", type: "text" }],
  adaptive_region: [{ key: "region_id", label: "Protected region", type: "text" }, { key: "max_plan_nodes", label: "Maximum plan nodes", type: "number", min: 1 }, { key: "max_plan_edges", label: "Maximum plan edges", type: "number", min: 1 }, { key: "max_replans", label: "Maximum replans", type: "number", min: 0 }],
  terminal: [{ key: "outcome", label: "Terminal outcome", type: "text" }],
};

function DefinitionControls({ document, onCommit }: { document: SemanticDocument; onCommit: (next: SemanticDocument) => void }): JSX.Element {
  const update = (change: (next: SemanticDocument) => void): void => {
    const next = cloneDocument(document);
    change(next);
    onCommit(next);
  };
  return <section className="definition-controls panel-card" aria-label="Definition settings and limits">
    <div className="panel-title"><div><p className="eyebrow">Definition contract</p><h2>Mode, policy and budgets</h2></div><span className="muted">semantic fields</span></div>
    <div className="definition-field-grid">
      <label className="field-label">Execution mode<select value={document.mode} onChange={(event) => update((next) => { next.mode = event.target.value as SemanticDocument["mode"]; })}><option value="strict">strict</option><option value="dynamic">dynamic</option></select></label>
      <DefinitionTextField label="Game profile" value={document.game_profile} maxLength={128} onCommit={(value) => update((next) => { next.game_profile = value; })} />
      <DefinitionTextField label="Policy reference" value={document.policy_ref} maxLength={128} onCommit={(value) => update((next) => { next.policy_ref = value; })} />
      <label className="field-label">Entry graph<select value={document.entry_graph} onChange={(event) => update((next) => { next.entry_graph = event.target.value; })}>{document.graphs.map((graph) => <option key={graph.id} value={graph.id}>{graph.id}</option>)}</select></label>
    </div>
    <div className="limit-grid">
      <BoundedNumberField label="Max steps" value={document.limits.max_steps} min={1} onCommit={(value) => update((next) => { next.limits.max_steps = value; })} />
      <BoundedNumberField label="Subworkflow depth" value={document.limits.max_subworkflow_depth} min={0} onCommit={(value) => update((next) => { next.limits.max_subworkflow_depth = value; })} />
      <BoundedNumberField label="Provider calls" value={document.limits.max_provider_calls} min={0} onCommit={(value) => update((next) => { next.limits.max_provider_calls = value; })} />
      <BoundedNumberField label="Parallel analyses" value={document.limits.max_parallel_analyses} min={1} onCommit={(value) => update((next) => { next.limits.max_parallel_analyses = value; })} />
      <BoundedNumberField label="Output tokens" value={document.limits.max_output_tokens} min={1} onCommit={(value) => update((next) => { next.limits.max_output_tokens = value; })} />
    </div>
    <div className="guard-editor">
      <div className="panel-title"><div><p className="eyebrow">Typed guards</p><h3>Ordered guard expressions</h3></div><span className="muted">unknown values remain explicit</span></div>
      {document.graphs.map((graph, graphIndex) => <div className="guard-group" key={graph.id}>
        <strong>{graph.id}</strong>
        {(graph.guards ?? []).map((guard, guardIndex) => <GuardField key={guard.id} guard={guard} onCommit={(nextGuard) => update((next) => { const nextGraph = next.graphs[graphIndex]; nextGraph.guards = [...(nextGraph.guards ?? [])]; nextGraph.guards[guardIndex] = nextGuard; })} />)}
        <button className="button button-quiet" onClick={() => update((next) => { const nextGraph = next.graphs[graphIndex]; nextGraph.guards = [...(nextGraph.guards ?? []), { id: `guard_${(nextGraph.guards?.length ?? 0) + 1}`, expression: { kind: "exists", value: "" } }]; })}>＋ Guard</button>
      </div>)}
    </div>
  </section>;
}

function BoundedNumberField({ label, value, min, onCommit }: { label: string; value: number; min: number; onCommit: (value: number) => void }): JSX.Element {
  const [draft, setDraft] = useState(String(value));
  const [error, setError] = useState<string | undefined>();
  useEffect(() => setDraft(String(value)), [value]);
  return <label className="field-label">{label}<input type="number" value={draft} min={min} onChange={(event) => { setDraft(event.target.value); setError(undefined); }} onBlur={() => {
    const next = Number(draft);
    if (!Number.isSafeInteger(next) || next < min) {
      setError(`Enter a safe integer ≥ ${min}.`);
      return;
    }
    setError(undefined);
    onCommit(next);
  }} />{error ? <span className="field-error" role="alert">{error}</span> : null}</label>;
}

function DefinitionTextField({ label, value, maxLength, onCommit }: { label: string; value: string; maxLength: number; onCommit: (value: string) => void }): JSX.Element {
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | undefined>();
  useEffect(() => setDraft(value), [value]);
  return <label className="field-label">{label}<input value={draft} maxLength={maxLength} onChange={(event) => { setDraft(event.target.value); setError(undefined); }} onBlur={() => {
    if (draft.trim().length === 0) {
      setError("This owner reference cannot be empty.");
      return;
    }
    setError(undefined);
    onCommit(draft);
  }} />{error ? <span className="field-error" role="alert">{error}</span> : null}</label>;
}

type WorkflowGuard = NonNullable<SemanticDocument["graphs"][number]["guards"]>[number];

function GuardField({ guard, onCommit }: { guard: WorkflowGuard; onCommit: (guard: WorkflowGuard) => void }): JSX.Element {
  const [text, setText] = useState(JSON.stringify(guard.expression, null, 2));
  const [error, setError] = useState<string | undefined>();
  useEffect(() => setText(JSON.stringify(guard.expression, null, 2)), [guard.expression]);
  return <div className="guard-field"><label className="field-label">{guard.id}<textarea rows={3} value={text} onChange={(event) => { setText(event.target.value); setError(undefined); }} onBlur={() => {
    try {
      const parsed = parseBoundedJson(text, { maxBytes: 16 * 1024, maxDepth: 12, maxNodes: 256 });
      const object = JsonObjectSchema.safeParse(parsed);
      if (!object.success) throw new Error("guard expression must be a JSON object");
      setError(undefined);
      onCommit({ ...guard, expression: object.data });
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Guard expression is invalid.");
    }
  }} />{error ? <span className="field-error" role="alert">{error}</span> : null}</label></div>;
}

function RawDefinitionPanel({ rawText, error, onChange, onApply }: { rawText: string; error: string | undefined; onChange: (value: string) => void; onApply: () => void }): JSX.Element {
  return <section className="raw-definition-panel panel-card" aria-label="Raw definition editor"><div className="panel-title"><div><p className="eyebrow">Bounded JSON mode</p><h2>Owner definition candidate</h2></div><button className="button button-primary" onClick={onApply}>Apply candidate</button></div><p className="muted">Duplicate keys, unsafe numbers, excessive depth, and unsupported schemas are rejected or retained read-only before admission.</p><textarea value={rawText} rows={18} spellCheck={false} onChange={(event) => onChange(event.target.value)} aria-label="Raw workflow definition JSON" />{error ? <p className="field-error" role="alert">{error}</p> : null}</section>;
}

function isEditableShortcutTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || Boolean(target.closest("input, textarea, select, button, [role=\"textbox\"], [contenteditable=\"true\"]"));
}

function ArchivalImportPanel({ archival }: { archival: ArchivalImport }): JSX.Element {
  return <section className="raw-definition-panel panel-card archival-import" aria-label="Read-only archival import">
    <Notice tone="warning" title="Read-only archival import">{`${archival.schemaVersion}: ${archival.reason}`}</Notice>
    <p className="muted">The original import text is retained locally for review only. It is not applied to this draft, autosaved, validated, or published.</p>
    <textarea value={archival.rawText} rows={12} readOnly spellCheck={false} aria-label="Archived unsupported workflow definition JSON" />
  </section>;
}

function ConflictPanel({ base, local, remote, onKeepRemote, onKeepLocal, onMerge }: { base: SemanticDocument; local: SemanticDocument; remote: SemanticDocument; onKeepRemote: () => void; onKeepLocal: () => Promise<void>; onMerge: () => void }): JSX.Element {
  const localPaths = diffDocuments(base, local).map((change) => change.path);
  const remotePaths = diffDocuments(base, remote).map((change) => change.path);
  const merge = mergeDocuments(base, local, remote);
  return <section className="conflict-panel panel-card" aria-labelledby="conflict-title"><div className="panel-title"><div><p className="eyebrow">Three-way review</p><h2 id="conflict-title">Local and remote drafts diverged</h2></div><StatusBadge tone={merge.conflicts.length ? "danger" : "success"}>{merge.conflicts.length ? `${merge.conflicts.length} conflicts` : "mergeable"}</StatusBadge></div><p className="muted">The base candidate, local edits, and owner revision stay visible until an explicit resolution. Layout movement is reviewed separately from semantic changes.</p><div className="conflict-columns"><div><strong>Local paths</strong><code>{localPaths.slice(0, 8).join("\n") || "none"}</code></div><div><strong>Remote paths</strong><code>{remotePaths.slice(0, 8).join("\n") || "none"}</code></div></div><div className="control-grid"><button className="button button-secondary" onClick={onMerge} disabled={merge.conflicts.length > 0}>Apply non-overlapping merge</button><button className="button button-quiet" onClick={() => void onKeepLocal()}>Save local as new draft</button><button className="button button-danger-outline" onClick={onKeepRemote}>Reload remote</button></div></section>;
}

function EdgeInspector({ document, selectedEdge, onReconnect }: { document: SemanticDocument; selectedEdge: { graphId: string; edgeIndex: number }; onReconnect: (from: string, to: string) => void }): JSX.Element {
  const graph = document.graphs.find((candidate) => candidate.id === selectedEdge.graphId);
  const edge = graph?.edges[selectedEdge.edgeIndex];
  const [from, setFrom] = useState(edge?.from ?? "");
  const [to, setTo] = useState(edge?.to ?? "");
  useEffect(() => { setFrom(edge?.from ?? ""); setTo(edge?.to ?? ""); }, [edge?.from, edge?.to]);
  if (!graph || !edge) return <aside className="inspector-panel"><p className="muted">The selected edge is no longer present.</p></aside>;
  return <aside className="inspector-panel edge-inspector" aria-label="Edge inspector"><div className="panel-title"><div><p className="eyebrow">Edge inspector</p><h2>{edge.on} / priority {edge.priority}</h2></div><StatusBadge tone="warning">semantic edit</StatusBadge></div><label className="field-label">Source<select value={from} onChange={(event) => setFrom(event.target.value)}>{graph.nodes.map((node) => <option key={node.id} value={node.id}>{node.id}</option>)}</select></label><label className="field-label">Target<select value={to} onChange={(event) => setTo(event.target.value)}>{graph.nodes.map((node) => <option key={node.id} value={node.id}>{node.id}</option>)}</select></label><button className="button button-secondary" onClick={() => onReconnect(from, to)}>Apply reconnection</button></aside>;
}

interface ListEditorProps {
  document: SemanticDocument;
  selectedId: string | undefined;
  selectedIds: string[];
  onSelect: (id: string, additive?: boolean) => void;
  onUpdate: (update: (node: WorkflowNode) => WorkflowNode) => void;
  onRemove: () => void;
}

function ListEditor({ document, selectedId, selectedIds, onSelect, onUpdate, onRemove }: ListEditorProps): JSX.Element {
  const selected = findSelectedNode(document, selectedId);
  return <div className="list-editor">
    <div className="list-editor-main">
      <div className="panel-title"><div><p className="eyebrow">Equivalent editor</p><h2>Semantic node list</h2></div><span className="muted">Keyboard friendly</span></div>
      <nav className="graph-breadcrumbs" aria-label="Workflow graph breadcrumbs">{document.graphs.map((graph) => <button key={graph.id} className="button button-quiet" onClick={() => { const first = graph.nodes[0]; if (first) onSelect(`${graph.id}:${first.id}`); }}>{graph.id}</button>)}</nav>
      {document.graphs.map((graph) => <div className="graph-list" key={graph.id}>
        <div className="graph-list-title"><span>{graph.id}</span><span className="muted">entry: {graph.entry_node}</span></div>
        {graph.nodes.map((node) => {
          const id = `${graph.id}:${node.id}`;
          return <button className={`node-list-row ${selectedIds.includes(id) ? "selected" : ""}`} key={id} onClick={(event) => onSelect(id, event.metaKey || event.ctrlKey)} aria-pressed={selectedIds.includes(id)}>
            <span className="node-kind-icon" aria-hidden="true">{node.kind === "adaptive_region" ? "◇" : "•"}</span>
            <span><strong>{node.id}</strong><small>{node.kind}</small></span>
            {node.kind === "adaptive_region" ? <StatusBadge tone="warning">protected</StatusBadge> : null}
          </button>;
        })}
      </div>)}
    </div>
    <InspectorPanel selected={selected} selectedConfigText={selected ? JSON.stringify(selected.node.config, null, 2) : ""} onUpdate={onUpdate} onRemove={onRemove} />
  </div>;
}

function DiagnosticsPanel({ result, onFocusPath }: { result: ValidateResponse; onFocusPath: (path: string) => void }): JSX.Element {
  return <div className={`diagnostics-panel ${result.valid ? "diagnostics-valid" : "diagnostics-invalid"}`}>
    <div className="panel-title"><div><p className="eyebrow">Owner validation</p><h2>{result.valid ? "Definition admitted" : "Definition needs attention"}</h2></div><code>{result.definition_digest.slice(0, 16)}…</code></div>
    {result.diagnostics.length === 0 ? <p className="muted">No diagnostics returned by the active adapter.</p> : <ul className="diagnostics-list">{result.diagnostics.map((diagnostic, index) => <li key={`${diagnostic.code}-${index}`}><StatusBadge tone={diagnostic.severity === "error" ? "danger" : diagnostic.severity === "warning" ? "warning" : "muted"}>{diagnostic.severity}</StatusBadge><button className="diagnostic-target" onClick={() => onFocusPath(diagnostic.path)} aria-label={`Focus diagnostic ${diagnostic.path}`}><code>{diagnostic.path}</code></button><span>{diagnostic.message}</span></li>)}</ul>}
  </div>;
}

const nodeKinds = ["observe", "decide", "execute_action", "route", "loop", "adaptive_region", "terminal"];

function toFlowNodes(document: SemanticDocument, layout: LayoutSidecar, selectedIds: string[] = []): FlowNode[] {
  return createFlowProjection({ semantic: document, layout }).nodes.map((node) => ({
    id: node.id,
    position: node.position,
    data: node.data,
    selected: selectedIds.includes(node.id),
    draggable: !node.data.locked,
    selectable: true,
    className: node.data.locked ? "protected-node" : "",
  }));
}

function toFlowEdges(document: SemanticDocument): Edge<{ qualifiedSource: string; qualifiedTarget: string }>[] {
  return createFlowProjection({ semantic: document, layout: createLayout(document, "pending") }).edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    label: edge.label,
    type: "smoothstep",
    data: edge.data,
    animated: false,
  }));
}

function findSelectedNode(document: SemanticDocument, selectedId: string | undefined): SelectedNode | undefined {
  if (!selectedId) return undefined;
  const split = splitQualifiedId(selectedId);
  if (!split) return undefined;
  const graph = document.graphs.find((candidate) => candidate.id === split.graphId);
  const node = graph?.nodes.find((candidate) => candidate.id === split.nodeId);
  return graph && node ? { graphId: graph.id, node } : undefined;
}

function locateEdge(document: SemanticDocument, edgeId: string): { graphId: string; edgeIndex: number } | undefined {
  for (const graph of document.graphs) {
    for (const [edgeIndex, edge] of graph.edges.entries()) {
      const source = qualifiedNodeId(graph.id, edge.from);
      const target = qualifiedNodeId(graph.id, edge.to);
      if (`${source}->${target}:${edge.on}:${edge.priority}` === edgeId) return { graphId: graph.id, edgeIndex };
    }
  }
  return undefined;
}

function splitQualifiedId(value: string): { graphId: string; nodeId: string } | undefined {
  const separator = value.indexOf(":");
  if (separator <= 0 || separator === value.length - 1) return undefined;
  return { graphId: value.slice(0, separator), nodeId: value.slice(separator + 1) };
}

function nextNodeId(ids: string[]): string {
  let index = 1;
  while (ids.includes(`studio_node_${index}`)) index += 1;
  return `studio_node_${index}`;
}
