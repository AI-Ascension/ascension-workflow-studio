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
  applyNodeChanges,
  type Connection,
  type Edge,
  type NodeChange,
} from "@xyflow/react";

import {
  JsonObjectSchema,
  LayoutSidecarSchema,
  type DefinitionRecord,
  type ContextBinding,
  type DraftRecord,
  type JsonObject,
  type JsonValue,
  type LayoutSidecar,
  type ValidateResponse,
  type WorkflowDefinition,
  type WorkflowNode,
} from "@studio/contracts";
import { CapabilityGateError, type StudioClient } from "@studio/client";
import { beginBenchmarkEdit, endBenchmarkEdit, recordBenchmarkHandler, recordFirstUsefulRender } from "../benchmark/benchmark";
import {
  alignLayout,
  autoLayout,
  addEdge,
  addNode,
  cloneDocument,
  copyNodes,
  createLayout,
  diffDocuments,
  layoutIsValid,
  mergeDocuments,
  mergeLayoutSidecars,
  canonicalJson,
  createEditGeneration,
  semanticDigest,
  parseBoundedJson,
  parseDefinitionImport,
  removeNode,
  reconnectEdge,
  updateEdge,
  defaultNodeConfig,
  parseStudioBundle,
  pasteNodes,
  serializeStudioBundle,
  updateLayout,
  updateNode,
  type NodeClipboard,
  type SemanticDocument,
} from "@studio/document";

import { Notice } from "../../components/Notice";
import { StatusBadge } from "../../components/StatusBadge";
import { useContextOwnerCatalog } from "./useContextOwnerCatalog";
import { ContextOwnerCatalogPanel } from "./ContextOwnerCatalogPanel";
import { ArchivalImportPanel, type ArchivalImport } from "./ArchivalImportPanel";
import { RawDefinitionPanel } from "./RawDefinitionPanel";
import { RecoveryPanel } from "./RecoveryPanel";
import { BundleImportPreview, BundlePreviewDetails, type BundleImportValue } from "./BundleImportPreview";
import { useRecoveryWorkflows } from "./useRecoveryWorkflows";

import { InspectorPanel } from "./InspectorPanel";

import { DefinitionControls } from "./DefinitionControls";
import { EdgeInspector } from "./EdgeInspector";

import { DesignerCanvas } from "./DesignerCanvas";
import { DiagnosticsPanel } from "./DiagnosticsPanel";
import { GraphNavigator } from "./GraphNavigator";
import { ListEditor } from "./ListEditor";
import { toFlowEdges, type FlowNode } from "./graphProjection";
import { findSelectedNode, locateEdge, minimapNodeColor, nextNodeId, splitQualifiedId } from "./selectionModel";
import { useEditorHistory, type EditorSnapshot } from "./useEditorHistory";

type EditorTab = "canvas" | "list";

interface DesignerViewProps {
  client: StudioClient;
  catalog: DefinitionRecord[];
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

export function DesignerView({ client, catalog, definition, initialDocument, initialRawText, mode, onBack, onRun, onRawTextChange }: DesignerViewProps): JSX.Element {
  const { document, layout, nodes, setDocument, setLayout, setNodes, documentRef, layoutRef, history, ensureLayout, syncFlowNodes, resetHistory } = useEditorHistory(initialDocument);
  const [tab, setTab] = useState<EditorTab>("canvas");
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedEdge, setSelectedEdge] = useState<{ graphId: string; edgeIndex: number } | undefined>();
  const [clipboard, setClipboard] = useState<NodeClipboard | undefined>();
  const [rawMode, setRawMode] = useState(false);
  const [rawText, setRawText] = useState(() => initialRawText ?? JSON.stringify(initialDocument, null, 2));
  const [rawError, setRawError] = useState<string | undefined>();
  const [archivalImport, setArchivalImport] = useState<ArchivalImport | undefined>();
  const [bundleImport, setBundleImport] = useState<BundleImportValue | undefined>();
  const [bundlePreview, setBundlePreview] = useState<string | undefined>();
  const [diagnostics, setDiagnostics] = useState<ValidateResponse | undefined>();
  const [validationState, setValidationState] = useState<"idle" | "running" | "valid" | "invalid" | "error">("idle");
  const [validationMessage, setValidationMessage] = useState("");
  const ownerCatalog = useContextOwnerCatalog(client, client.principal());
  const contextBindings = ownerCatalog.bindings;
  const [draft, setDraft] = useState<DraftState>({ revision: 0, etag: "fixture-0", state: "saved", message: "Draft changes are local until autosave completes." });
  const [draftHydrated, setDraftHydrated] = useState(false);
  const [saveRetry, setSaveRetry] = useState(0);
  const [publicationState, setPublicationState] = useState<"idle" | "publishing">("idle");
  const draftRef = useRef(draft);
  const [conflictOpen, setConflictOpen] = useState(true);
  const [focusedGraph, setFocusedGraph] = useState<string>(() => initialDocument.entry_graph);
  const [graphTrail, setGraphTrail] = useState<string[]>(() => [initialDocument.entry_graph]);
  const [graphViewports, setGraphViewports] = useState<Record<string, { x: number; y: number; zoom: number }>>({});
  const mergeBaseRef = useRef<SemanticDocument>(cloneDocument(initialDocument));
  const mergeBaseLayoutRef = useRef<LayoutSidecar>(createLayout(initialDocument, "pending"));
  const persistedKeyRef = useRef<string | undefined>(undefined);
  const mutationIdsRef = useRef(new Map<string, string>());
  const publicationIdsRef = useRef(new Map<string, string>());
  const saveGenerationRef = useRef(0);
  const editGeneration = useRef(createEditGeneration());
  const bundleInput = useRef<HTMLInputElement>(null);

  draftRef.current = draft;


  const draftId = `draft.${definition.id}`;

  const valueKey = (nextDocument: SemanticDocument, nextLayout: LayoutSidecar): string => JSON.stringify({ document: nextDocument, layout: nextLayout });

  useEffect(() => {
    const nextLayout = createLayout(initialDocument, "pending");
    resetHistory(initialDocument, nextLayout);
    setDocument(initialDocument);
    setLayout(nextLayout);
    syncFlowNodes(initialDocument, nextLayout);
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
    mergeBaseRef.current = cloneDocument(initialDocument);
    mergeBaseLayoutRef.current = nextLayout;
    setConflictOpen(true);
    setFocusedGraph(initialDocument.entry_graph);
    setGraphTrail([initialDocument.entry_graph]);
    setGraphViewports({});
    setDraft({ revision: 0, etag: "fixture-0", state: "saved", message: "Draft changes are local until autosave completes." });
    recordFirstUsefulRender();
  }, [initialDocument]);

  useEffect(() => {
    let active = true;
    const loadDraft = async (): Promise<void> => {
      const loadGeneration = saveGenerationRef.current;
      try {
        const saved = await client.getDraft(draftId);
        if (!active) return;
        // A save that started after this load must win; a late load response
        // cannot repopulate newer local state.
        if (saveGenerationRef.current !== loadGeneration) return;
        if (saved) {
          const parsedLayout = LayoutSidecarSchema.safeParse(saved.layout);
          const nextLayout = parsedLayout.success ? parsedLayout.data : createLayout(saved.document, "pending");
          resetHistory(saved.document, nextLayout);
          mergeBaseRef.current = cloneDocument(saved.document);
          mergeBaseLayoutRef.current = nextLayout;
          setFocusedGraph(saved.document.entry_graph);
          setGraphTrail([saved.document.entry_graph]);
          if (saved.conflict) setConflictOpen(true);
          setDocument(saved.document);
          setLayout(nextLayout);
          syncFlowNodes(saved.document, nextLayout);
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
    if (archivalImport || !draftHydrated || draftRef.current.state === "conflict") return;
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
        if (!saved.conflict) {
          persistedKeyRef.current = currentKey;
          mergeBaseRef.current = cloneDocument(document);
          mergeBaseLayoutRef.current = layout;
        } else {
          persistedKeyRef.current = undefined;
          setConflictOpen(true);
        }
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
  }, [client, definition.id, draftHydrated, document, layout, draftId, saveRetry, archivalImport]);

  const selected = useMemo(() => findSelectedNode(document, selectedId), [document, selectedId]);
  const flowEdgesCache = useRef<{ key: string; edges: Edge<{ qualifiedSource: string; qualifiedTarget: string }>[] }>({ key: "", edges: [] });
  const flowEdges = useMemo(() => {
    const key = document.graphs.map((graph) => `${graph.id}:${graph.edges.map((edge) => `${edge.from}>${edge.to}:${edge.on}:${edge.priority}:${edge.guard_ref ?? ""}`).join(",")}`).join("|");
    if (key === flowEdgesCache.current.key) return flowEdgesCache.current.edges;
    const edges = toFlowEdges(document);
    flowEdgesCache.current = { key, edges };
    return edges;
  }, [document]);
  const activeGraphId = useMemo(() => (document.graphs.some((graph) => graph.id === focusedGraph) ? focusedGraph : document.entry_graph), [document.graphs, focusedGraph]);
  const visibleNodes = useMemo(() => nodes.filter((node) => node.id.startsWith(`${activeGraphId}:`)), [nodes, activeGraphId]);
  const visibleEdges = useMemo(() => flowEdges.filter((edge) => edge.source.startsWith(`${activeGraphId}:`)), [flowEdges, activeGraphId]);

  const focusGraph = useCallback((graphId: string): void => {
    if (!document.graphs.some((graph) => graph.id === graphId)) return;
    setFocusedGraph(graphId);
    setGraphTrail([graphId]);
  }, [document.graphs]);

  const focusTrailIndex = useCallback((index: number): void => {
    setGraphTrail((current) => {
      const next = current.slice(0, Math.max(0, Math.min(index + 1, current.length)));
      if (next.length > 0) setFocusedGraph(next[next.length - 1]);
      return next;
    });
  }, []);

  const navigateIntoGraph = useCallback((graphId: string): void => {
    if (!document.graphs.some((graph) => graph.id === graphId)) return;
    setFocusedGraph(graphId);
    setGraphTrail((current) => (current[current.length - 1] === graphId ? current : [...current, graphId]));
  }, [document.graphs]);

  const commitSnapshot = useCallback((nextDocument: SemanticDocument, nextLayout: LayoutSidecar): void => {
    const editStart = beginBenchmarkEdit();
    editGeneration.current.bump();
    const snapshotGeneration = editGeneration.current.current();
    const boundLayout = { ...ensureLayout(nextDocument, nextLayout), semanticDigest: "pending" } as LayoutSidecar;
    history.current.commit({ document: nextDocument, layout: boundLayout });
    setDocument(nextDocument);
    setLayout(boundLayout);
    syncFlowNodes(nextDocument, boundLayout);
    window.setTimeout(() => {
      // A rapid undo/redo or subsequent semantic edit must win over this
      // deferred serialization; otherwise an old conversion can overwrite the
      // current raw-text view after the user has already restored it.
      if (!editGeneration.current.isCurrent(snapshotGeneration)) return;
      const nextRawText = JSON.stringify(nextDocument, null, 2);
      setRawText(nextRawText);
      onRawTextChange(definition.id, nextRawText);
    }, 0);
    setRawError(undefined);
    setArchivalImport(undefined);
    setDiagnostics(undefined);
    setValidationState("idle");
    recordBenchmarkHandler(editStart);
    endBenchmarkEdit(editStart);
  }, [definition.id, ensureLayout, onRawTextChange]);

  const commit = useCallback((nextDocument: SemanticDocument): void => {
    commitSnapshot(nextDocument, layout);
  }, [commitSnapshot, layout]);

  const principal = client.principal();
  const recovery = useRecoveryWorkflows({
    principal,
    definitionId: definition.id,
    draftId,
    document,
    layout,
    rawText,
    suspended: Boolean(archivalImport),
  });

  const recoverLocalCandidate = (): void => {
    const candidate = recovery.recover();
    if (!candidate) return;
    commitSnapshot(candidate.document, candidate.layout);
    setRawText(candidate.raw_text ?? JSON.stringify(candidate.document, null, 2));
    setValidationState("idle");
    setValidationMessage("Recovered an unsaved local candidate; review and validate before saving.");
  };

  const restoreHistorySnapshot = useCallback((next: EditorSnapshot): void => {
    editGeneration.current.bump();
    setDocument(next.document);
    setLayout(next.layout);
    syncFlowNodes(next.document, next.layout, selectedIds);
    const nextRawText = JSON.stringify(next.document, null, 2);
    setRawText(nextRawText);
    onRawTextChange(definition.id, nextRawText);
    setRawError(undefined);
    setDiagnostics(undefined);
    setValidationState("idle");
    setValidationMessage("");
  }, [definition.id, onRawTextChange, selectedIds, syncFlowNodes]);

  const undo = (): void => {
    restoreHistorySnapshot(history.current.undo());
  };

  const retrySave = async (): Promise<void> => {
    if (draft.state !== "offline") return;
    setDraft((current) => ({ ...current, state: "saving", message: "Reconciling the owner revision before retrying…" }));
    try {
      const server = await client.getDraft(draftId);
      if (server) {
        const storedMatchesLocal = canonicalJson(server.document) === canonicalJson(document) && canonicalJson(server.layout) === canonicalJson(layout);
        if (storedMatchesLocal) {
          persistedKeyRef.current = valueKey(document, layout);
          mergeBaseRef.current = cloneDocument(server.document);
          setDraft({ revision: server.revision, etag: server.etag, state: "saved", message: "The owner already stored this candidate; the retry resolved to the existing revision." });
          return;
        }
        if (server.revision !== draft.revision || server.etag !== draft.etag) {
          setDraft({ revision: server.revision, etag: server.etag, state: "conflict", message: "The owner revision moved while this tab was offline; review the conflict before saving.", server });
          return;
        }
      }
    } catch {
      // Reconciliation is best-effort; a failed lookup falls back to the retry identity.
    }
    setDraft((current) => ({ ...current, state: "saving", message: "Retrying the same draft save identity…" }));
    setSaveRetry((current) => current + 1);
  };

  const redo = (): void => {
    restoreHistorySnapshot(history.current.redo());
  };

  const selectNode = useCallback((id: string, additive = false): void => {
    setSelectedId(id);
    setSelectedEdge(undefined);
    const owning = splitQualifiedId(id);
    if (owning) {
      setFocusedGraph(owning.graphId);
      setGraphTrail((current) => (current.includes(owning.graphId) ? current : [owning.graphId]));
    }
    setSelectedIds((current) => {
      const next = additive ? (current.includes(id) ? current.filter((candidate) => candidate !== id) : [...current, id]) : [id];
      setNodes((currentNodes) => currentNodes.map((node) => {
        const wanted = next.includes(node.id);
        return node.selected === wanted ? node : { ...node, selected: wanted };
      }));
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
      if (archivalImport || event.defaultPrevented || !(event.ctrlKey || event.metaKey) || isEditableShortcutTarget(event.target)) return;
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
      syncFlowNodes(document, nextLayout);
      setValidationState("valid");
      setValidationMessage("Aligned the selected nodes without changing semantic execution.");
    } catch (error: unknown) {
      setValidationState("error");
      setValidationMessage(error instanceof Error ? error.message : "Alignment was rejected.");
    }
  };

  const arrangeLayout = (): void => {
    try {
      const nextLayout = autoLayout(layout, document);
      history.current.commit({ document, layout: nextLayout });
      setLayout(nextLayout);
      syncFlowNodes(document, nextLayout, selectedIds);
      setValidationState("valid");
      setValidationMessage("Auto-arranged the layout without changing semantic execution.");
    } catch (error: unknown) {
      setValidationState("error");
      setValidationMessage(error instanceof Error ? error.message : "Auto-layout was rejected.");
    }
  };

  const openArchive = (imported: ArchivalImport): void => {
    // Invalidate pending validation/publication before suspending the editor.
    editGeneration.current.bump();
    setArchivalImport(imported);
    setDiagnostics(undefined);
    setValidationState("idle");
    setValidationMessage("");
    setBundleImport(undefined);
  };

  const applyRawDefinition = (): void => {
    try {
      const imported = parseDefinitionImport(rawText);
      if (imported.kind === "archival") {
        openArchive(imported);
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

  // Stable handler identities keep React Flow's memoized node/edge wrappers
  // from re-rendering on every unrelated state update (P2-089).
  const onNodesChange = useCallback((changes: NodeChange<FlowNode>[]): void => {
    setNodes((currentNodes) => {
      const nextNodes = applyNodeChanges(changes, currentNodes);
      const positions: Record<string, { x: number; y: number }> = {};
      for (const node of nextNodes) {
        positions[node.id] = node.position;
      }
      setLayout((current) => updateLayout(current, positions));
      return nextNodes;
    });
  }, []);

  const onConnect = useCallback((connection: Connection): void => {
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
  }, [commit, document]);

  const onEdgeClick = useCallback((_event: ReactMouseEvent, edge: Edge): void => {
    const located = locateEdge(document, edge.id);
    if (!located) return;
    setSelectedEdge(located);
    setSelectedIds([]);
    setSelectedId(undefined);
  }, [document]);

  const onNodeClick = useCallback((event: ReactMouseEvent, node: FlowNode): void => {
    selectNode(node.id, event.metaKey || event.ctrlKey);
  }, [selectNode]);

  const onMoveEnd = useCallback((_event: unknown, viewport: { x: number; y: number; zoom: number }): void => {
    setGraphViewports((current) => ({ ...current, [activeGraphId]: viewport }));
  }, [activeGraphId]);

  const onNodeDragStop = useCallback((_event: MouseEvent | TouchEvent, node: FlowNode): void => {
    const nextLayout = updateLayout(layoutRef.current, { [node.id]: node.position });
    history.current.commit({ document: documentRef.current, layout: nextLayout });
    setLayout(nextLayout);
    syncFlowNodes(documentRef.current, nextLayout);
  }, [syncFlowNodes]);

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

  const applyEdgeUpdate = (update: (edge: SemanticDocument["graphs"][number]["edges"][number]) => SemanticDocument["graphs"][number]["edges"][number]): void => {
    if (!selectedEdge) return;
    try {
      commit(updateEdge(document, selectedEdge.graphId, selectedEdge.edgeIndex, update));
      setValidationState("valid");
      setValidationMessage("Updated the guarded edge as a semantic edit.");
    } catch (error: unknown) {
      setValidationState("error");
      setValidationMessage(error instanceof Error ? error.message : "Edge update was rejected.");
    }
  };

  const validate = async (): Promise<void> => {
    setValidationState("running");
    setValidationMessage("");
    const generation = editGeneration.current.current();
    try {
      const result = await client.validate(document);
      if (!editGeneration.current.isCurrent(generation)) return;
      setDiagnostics(result);
      setValidationState(result.valid ? "valid" : "invalid");
      setValidationMessage(result.valid ? `Validated at ${result.definition_digest.slice(0, 12)}…` : `${result.diagnostics.length} diagnostic${result.diagnostics.length === 1 ? "" : "s"} reported.`);
      const layoutBinding = await semanticDigest(document);
      const boundLayout = { ...layout, semanticDigest: layoutBinding } as LayoutSidecar;
      if (persistedKeyRef.current === valueKey(document, layout)) {
        persistedKeyRef.current = valueKey(document, boundLayout);
      }
      setLayout(boundLayout);
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
    const generation = editGeneration.current.current();
    try {
      const validation = await client.validate(document);
      if (!editGeneration.current.isCurrent(generation)) return;
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
    const graph = document.graphs.find((candidate) => candidate.id === activeGraphId);
    if (!graph) return;
    const id = nextNodeId(graph.nodes.map((node) => node.id));
    const node: WorkflowNode = { id, kind: "observe", config: defaultNodeConfig("observe") };
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
      // A larger bundle can still be resolving when a browser handles the
      // synthetic anchor click. Keep the blob URL alive through that handoff.
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
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
    const generation = editGeneration.current.current();
    const raw = await file.text();
    if (!editGeneration.current.isCurrent(generation)) return;
    try {
      const bundle = await parseStudioBundle(raw);
      const digest = await semanticDigest(bundle.semantic);
      if (!editGeneration.current.isCurrent(generation)) return;
      setBundleImport({
        semantic: bundle.semantic,
        layout: bundle.layout,
        digest,
        changedPaths: diffDocuments(document, bundle.semantic).map((change) => change.path),
        capabilities: bundle.semantic.capabilities.required,
      });
      setValidationState("idle");
      setValidationMessage("Review the digest-bound bundle preview before applying it.");
    } catch (error: unknown) {
      if (!editGeneration.current.isCurrent(generation)) return;
      try {
        const imported = parseDefinitionImport(raw);
        if (imported.kind === "archival") {
          openArchive(imported);
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

  const applyBundleImport = (): void => {
    if (!bundleImport) return;
    resetHistory(bundleImport.semantic, bundleImport.layout);
    setDocument(bundleImport.semantic);
    setLayout(bundleImport.layout);
    syncFlowNodes(bundleImport.semantic, bundleImport.layout);
    setSelectedId(undefined);
    setSelectedIds([]);
    setSelectedEdge(undefined);
    setRawText(JSON.stringify(bundleImport.semantic, null, 2));
    setArchivalImport(undefined);
    setDiagnostics(undefined);
    setBundleImport(undefined);
    setValidationState("valid");
    setValidationMessage("Imported and verified a digest-bound Studio bundle.");
  };

  const cancelBundleImport = (): void => {
    setBundleImport(undefined);
    setValidationState("idle");
    setValidationMessage("Bundle import cancelled; the current document is unchanged.");
  };

  const updateSelected = (update: (node: WorkflowNode) => WorkflowNode): void => {
    if (!selected) return;
    try {
      const preview = update(selected.node);
      if (selected.node.kind === "adaptive_region" && preview.kind !== "adaptive_region") return;
      commit(updateNode(document, selected.graphId, selected.node.id, () => preview));
    } catch (error: unknown) {
      setValidationState("error");
      setValidationMessage(error instanceof Error ? error.message : "Node update was rejected.");
    }
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

  const reloadRemoteConflict = (): void => {
    const remote = draft.server?.conflict?.serverDocument;
    if (!remote || !draft.server) return;
    const remoteLayoutResult = LayoutSidecarSchema.safeParse(draft.server.conflict?.serverLayout ?? draft.server.layout);
    const remoteLayout = remoteLayoutResult.success ? remoteLayoutResult.data : createLayout(remote, "pending");
    resetHistory(remote, remoteLayout);
    mergeBaseRef.current = cloneDocument(remote);
    mergeBaseLayoutRef.current = remoteLayout;
    setDocument(remote);
    setLayout(remoteLayout);
    syncFlowNodes(remote, remoteLayout);
    setRawText(JSON.stringify(remote, null, 2));
    persistedKeyRef.current = valueKey(remote, remoteLayout);
    setConflictOpen(true);
    setDraft({ revision: draft.server.revision, etag: draft.server.etag, state: "saved", message: "Remote revision loaded; local conflict was discarded." });
  };

  const saveLocalAsNew = async (): Promise<void> => {
    try {
      const saved = await client.saveDraft({ draftId: `draft.${definition.id}.copy.${Date.now()}`, definitionId: definition.id, revision: 0, etag: "fixture-0", document, layout, clientMutationId: `studio.copy.${Date.now()}` });
      mergeBaseRef.current = cloneDocument(saved.document);
      const parsedLayout = LayoutSidecarSchema.safeParse(saved.layout);
      mergeBaseLayoutRef.current = parsedLayout.success ? parsedLayout.data : createLayout(saved.document, "pending");
      setDraft({ revision: saved.revision, etag: saved.etag, state: "saved", message: "Local candidate was saved as a new draft." });
    } catch (error: unknown) {
      setDraft((current) => ({ ...current, state: "conflict", message: error instanceof Error ? error.message : "Could not save a new draft; the local candidate is preserved." }));
    }
  };

  const cancelConflictResolution = (): void => {
    setConflictOpen(false);
  };

  const mergeConflict = async (): Promise<void> => {
    const server = draft.server;
    const remote = server?.conflict?.serverDocument;
    if (!remote || !server) return;
    const remoteLayoutResult = LayoutSidecarSchema.safeParse(server.conflict?.serverLayout ?? server.layout);
    const remoteLayout = remoteLayoutResult.success ? remoteLayoutResult.data : createLayout(remote, "pending");
    const semantic = mergeDocuments(mergeBaseRef.current, document, remote);
    if (semantic.conflicts.length > 0 || !semantic.document) {
      setValidationState("error");
      setValidationMessage(`Merge needs review at ${semantic.conflicts.map((conflict) => conflict.path).join(", ")}.`);
      return;
    }
    const neutral = (side: LayoutSidecar): LayoutSidecar => ({ ...side, semanticDigest: "merge" });
    const layoutMerge = mergeLayoutSidecars(neutral(mergeBaseLayoutRef.current), neutral(layout), neutral(remoteLayout));
    const nextLayout = layoutMerge.layout ?? layout;
    commitSnapshot(semantic.document, nextLayout);
    setConflictOpen(true);
    setDraft({ revision: server.revision, etag: server.etag, state: "saving", message: "Saving the reviewed merge against the owner revision…" });
    setValidationState("running");
    setValidationMessage("Merged candidate requires fresh validation.");
    setDiagnostics(undefined);
    const generation = editGeneration.current.current();
    try {
      const result = await client.validate(semantic.document);
      if (!editGeneration.current.isCurrent(generation)) return;
      setDiagnostics(result);
      setValidationState(result.valid ? "valid" : "invalid");
      setValidationMessage(result.valid
        ? `Merged semantic and layout candidates revalidated at ${result.definition_digest.slice(0, 12)}…`
        : `${result.diagnostics.length} diagnostic${result.diagnostics.length === 1 ? "" : "s"} reported for the merged candidate.`);
      const mergedLayoutBinding = await semanticDigest(semantic.document);
      setLayout((current) => ({ ...current, semanticDigest: mergedLayoutBinding }));
    } catch (error: unknown) {
      setValidationState("error");
      setValidationMessage(error instanceof Error ? error.message : "Merged candidate validation failed.");
    }
  };

  const selectedConfigText = selected ? JSON.stringify(selected.node.config, null, 2) : "";
  const layoutState = layoutIsValid(document, layout) ? "bound" : "repair needed";
  const conflictRemoteDocument = draft.server ? (draft.server.conflict?.serverDocument ?? draft.server.document) : undefined;
  const conflictRemoteLayout = conflictRemoteDocument
    ? (() => { const parsed = LayoutSidecarSchema.safeParse(draft.server?.conflict?.serverLayout ?? draft.server?.layout); return parsed.success ? parsed.data : createLayout(conflictRemoteDocument, "pending"); })()
    : undefined;

  if (archivalImport) return <section className="view-stack designer-view" aria-label="Archived workflow">
    <ArchivalImportPanel archival={archivalImport} />
    <button className="button button-secondary" onClick={() => {
      const previousText = JSON.stringify(document, null, 2);
      setRawText(previousText);
      onRawTextChange(definition.id, previousText);
      setRawError(undefined);
      setArchivalImport(undefined);
    }}>Return to previous draft</button>
  </section>;

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
        {draft.state === "offline" ? <button className="button button-secondary" onClick={() => void retrySave()}>Retry save</button> : null}
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
    <div className="identity-strip" aria-label="Compilation identities">
      <span>Draft revision <code data-testid="identity-draft-revision">{draft.revision}</code></span>
      <span>Definition digest <code data-testid="identity-definition-digest">{diagnostics ? `${diagnostics.definition_digest.slice(0, 16)}…` : "not validated"}</code></span>
      <span>Layout digest <code data-testid="identity-layout-digest">{layout.semanticDigest === "pending" || layout.semanticDigest === "merge" ? layout.semanticDigest : `${layout.semanticDigest.slice(0, 16)}…`}</code></span>
      <span>Compiler <code data-testid="identity-compiler">{diagnostics?.compiler ?? "not reported"}</code></span>
    </div>
    <p className="identity-note muted">Draft revision, definition digest, layout digest, and compiler identity are independent; none substitutes for another.</p>
    <ContextOwnerCatalogPanel state={ownerCatalog.state} refresh={ownerCatalog.refresh} />
    <RecoveryPanel enabled={recovery.enabled} principal={principal} count={recovery.principalRecordCount} recoverable={recovery.recoverable} notice={recovery.notice} onToggle={recovery.toggle} onRecover={recoverLocalCandidate} onExport={recovery.exportRecords} onClear={recovery.clear} />
    {draft.state === "conflict" ? <Notice tone="danger" title="Draft conflict">The server revision changed while this editor was saving. Local edits are preserved until an explicit resolution.</Notice> : null}
    {draft.state === "conflict" && conflictRemoteDocument && conflictRemoteLayout && conflictOpen ? <ConflictPanel base={mergeBaseRef.current} baseLayout={mergeBaseLayoutRef.current} local={document} localLayout={layout} remote={conflictRemoteDocument} remoteLayout={conflictRemoteLayout} onKeepRemote={reloadRemoteConflict} onKeepLocal={saveLocalAsNew} onMerge={mergeConflict} onCancel={cancelConflictResolution} /> : null}
    {draft.state === "conflict" && !conflictOpen ? <section className="panel-card conflict-dismissed" aria-label="Pending conflict review"><p>Conflict resolution cancelled; local and remote candidates remain available for review.</p><button className="button button-secondary" onClick={() => setConflictOpen(true)}>Review divergence</button></section> : null}
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
        <button className="button button-quiet" onClick={arrangeLayout}>Auto-layout</button>
        <button className={`button ${rawMode ? "button-secondary" : "button-quiet"}`} onClick={() => setRawMode((current) => !current)}>{rawMode ? "Close JSON" : "JSON mode"}</button>
        <button className="button button-quiet" onClick={() => void exportBundle()}>Export</button>
        <button className="button button-quiet" onClick={() => bundleInput.current?.click()}>Import</button>
        <input ref={bundleInput} className="sr-only" type="file" accept="application/json,.json" onChange={(event) => void importBundle(event)} />
      </div>
    </div>
    <DefinitionControls document={document} onCommit={commit} />
    {rawMode ? <RawDefinitionPanel rawText={rawText} error={rawError} onChange={(value) => { setRawText(value); onRawTextChange(definition.id, value); setRawError(undefined); }} onApply={applyRawDefinition} /> : null}
    {bundleImport ? <BundleImportPreview value={bundleImport} onApply={applyBundleImport} onCancel={cancelBundleImport} /> : null}
    {bundlePreview ? <BundlePreviewDetails preview={bundlePreview} /> : null}
    <GraphNavigator document={document} activeGraphId={activeGraphId} trail={graphTrail} onFocus={focusGraph} onSelectTrail={focusTrailIndex} />
    {tab === "canvas" ? <div className="designer-body">
      <DesignerCanvas
          activeGraphId={activeGraphId}
          nodes={visibleNodes}
          edges={visibleEdges}
          viewport={graphViewports[activeGraphId]}
          onMoveEnd={onMoveEnd}
          onNodesChange={onNodesChange}
          onConnect={onConnect}
          onNodeClick={onNodeClick}
          onEdgeClick={onEdgeClick}
          onNodeDragStop={onNodeDragStop}
          minimapNodeColor={minimapNodeColor}
        />
      <div className="inspector-stack">
        <InspectorPanel document={document} catalog={catalog} contextBindings={contextBindings} selected={selected} selectedConfigText={selectedConfigText} onUpdate={updateSelected} onRemove={removeSelected} onNavigateGraph={navigateIntoGraph} />
        {selectedEdge ? <EdgeInspector document={document} selectedEdge={selectedEdge} onReconnect={applyReconnect} onUpdate={applyEdgeUpdate} /> : null}
      </div>
    </div> : <ListEditor document={document} selectedIds={selectedIds} onSelect={selectNode} inspector={<InspectorPanel document={document} catalog={catalog} contextBindings={contextBindings} selected={selected} selectedConfigText={selectedConfigText} onUpdate={updateSelected} onRemove={removeSelected} onNavigateGraph={navigateIntoGraph} />} />}
    {diagnostics ? <DiagnosticsPanel result={diagnostics} onFocusPath={(path) => {
      const target = document.graphs.flatMap((graph) => graph.nodes.map((node) => ({ graphId: graph.id, nodeId: node.id }))).find((candidate) => path.includes(candidate.nodeId));
      if (target) {
        setTab("list");
        selectNode(`${target.graphId}:${target.nodeId}`);
      }
    }} /> : null}
  </section>;
}











function isEditableShortcutTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || Boolean(target.closest("input, textarea, select, button, [role=\"textbox\"], [contenteditable=\"true\"]"));
}

function ConflictPanel({ base, baseLayout, local, localLayout, remote, remoteLayout, onKeepRemote, onKeepLocal, onMerge, onCancel }: { base: SemanticDocument; baseLayout: LayoutSidecar; local: SemanticDocument; localLayout: LayoutSidecar; remote: SemanticDocument; remoteLayout: LayoutSidecar; onKeepRemote: () => void; onKeepLocal: () => Promise<void>; onMerge: () => Promise<void>; onCancel: () => void }): JSX.Element {
  const [reloadArmed, setReloadArmed] = useState(false);
  const localPaths = diffDocuments(base, local).map((change) => change.path);
  const remotePaths = diffDocuments(base, remote).map((change) => change.path);
  const layoutLocalPaths = diffDocuments(baseLayout, localLayout).map((change) => change.path);
  const layoutRemotePaths = diffDocuments(baseLayout, remoteLayout).map((change) => change.path);
  const merge = mergeDocuments(base, local, remote);
  const layoutMerge = mergeLayoutSidecars({ ...baseLayout, semanticDigest: "merge" }, { ...localLayout, semanticDigest: "merge" }, { ...remoteLayout, semanticDigest: "merge" });
  return <section className="conflict-panel panel-card" aria-labelledby="conflict-title">
    <div className="panel-title"><div><p className="eyebrow">Three-way review</p><h2 id="conflict-title">Local and remote drafts diverged</h2></div><StatusBadge tone={merge.conflicts.length ? "danger" : "success"}>{merge.conflicts.length ? `${merge.conflicts.length} conflicts` : "mergeable"}</StatusBadge></div>
    <p className="muted">The loaded base, local edits, and owner revision stay visible until an explicit resolution. Local content is never discarded without a protected confirmation.</p>
    <div className="conflict-columns"><div><strong>Local paths</strong><code>{localPaths.slice(0, 8).join("\n") || "none"}</code></div><div><strong>Remote paths</strong><code>{remotePaths.slice(0, 8).join("\n") || "none"}</code></div></div>
    <div className="conflict-columns"><div><strong>Local layout paths</strong><code>{layoutLocalPaths.slice(0, 8).join("\n") || "none"}</code></div><div><strong>Remote layout paths</strong><code>{layoutRemotePaths.slice(0, 8).join("\n") || "none"}</code></div></div>
    <p className="muted">Semantic {merge.conflicts.length ? "conflicts require review" : "changes merge cleanly"}; layout {layoutMerge.conflicts.length ? "movement also conflicts and local layout is kept" : "movement merges independently"}.</p>
    <div className="control-grid">
      <button className="button button-secondary" onClick={() => void onMerge()} disabled={merge.conflicts.length > 0}>Apply non-overlapping merge</button>
      <button className="button button-quiet" onClick={() => void onKeepLocal()}>Save local as new draft</button>
      {reloadArmed ? <><button className="button button-danger-outline" onClick={onKeepRemote}>Discard local and reload remote</button><button className="button button-quiet" onClick={() => setReloadArmed(false)}>Keep local edits</button></> : <button className="button button-danger-outline" onClick={() => setReloadArmed(true)}>Reload remote…</button>}
      <button className="button button-quiet" onClick={onCancel}>Cancel resolution</button>
    </div>
    {reloadArmed ? <p className="field-error" role="alert">Reloading replaces the local candidate with the owner revision and cannot be undone.</p> : null}
  </section>;
}
