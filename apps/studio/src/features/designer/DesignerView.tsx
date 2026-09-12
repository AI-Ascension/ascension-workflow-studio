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
  type JsonObject,
  type JsonValue,
  type LayoutSidecar,
  type ValidateResponse,
  type WorkflowDefinition,
  type WorkflowNode,
} from "@studio/contracts";
import { CapabilityGateError, type StudioClient } from "@studio/client";
import { IndexedDbRecoveryStore } from "./recoveryStore";
import { buildRecoveryRecord, recoverableFor, type RecoveryRecord } from "@studio/document";
import {
  History,
  alignLayout,
  autoLayout,
  addEdge,
  addNode,
  cloneDocument,
  copyNodes,
  createFlowProjection,
  createLayout,
  diffDocuments,
  layoutIsValid,
  mergeDocuments,
  mergeLayoutSidecars,
  canonicalJson,
  createEditGeneration,
  resolveSubworkflowReference,
  semanticDigest,
  parseBoundedJson,
  parseDefinitionImport,
  removeNode,
  reconnectEdge,
  parseStudioBundle,
  pasteNodes,
  qualifiedNodeId,
  GUARD_OPERATORS,
  encodeGuardValue,
  evaluateGuard,
  guardOperatorSpec,
  guardReferencedFields,
  isRegisteredGuardOperator,
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

export function DesignerView({ client, catalog, definition, initialDocument, initialRawText, mode, onBack, onRun, onRawTextChange }: DesignerViewProps): JSX.Element {
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
  const [bundleImport, setBundleImport] = useState<{ semantic: SemanticDocument; layout: LayoutSidecar; digest: string; changedPaths: string[]; capabilities: string[] } | undefined>();
  const [bundlePreview, setBundlePreview] = useState<string | undefined>();
  const [diagnostics, setDiagnostics] = useState<ValidateResponse | undefined>();
  const [validationState, setValidationState] = useState<"idle" | "running" | "valid" | "invalid" | "error">("idle");
  const [validationMessage, setValidationMessage] = useState("");
  const [draft, setDraft] = useState<DraftState>({ revision: 0, etag: "fixture-0", state: "saved", message: "Draft changes are local until autosave completes." });
  const [draftHydrated, setDraftHydrated] = useState(false);
  const [saveRetry, setSaveRetry] = useState(0);
  const [publicationState, setPublicationState] = useState<"idle" | "publishing">("idle");
  const draftRef = useRef(draft);
  const [conflictOpen, setConflictOpen] = useState(true);
  const [focusedGraph, setFocusedGraph] = useState<string>(() => initialDocument.entry_graph);
  const [graphTrail, setGraphTrail] = useState<string[]>(() => [initialDocument.entry_graph]);
  const [graphViewports, setGraphViewports] = useState<Record<string, { x: number; y: number; zoom: number }>>({});
  const [recoveryEnabled, setRecoveryEnabled] = useState(false);
  const [recoveryRecords, setRecoveryRecords] = useState<RecoveryRecord[]>([]);
  const [recoveryNotice, setRecoveryNotice] = useState("");
  const mergeBaseRef = useRef<SemanticDocument>(cloneDocument(initialDocument));
  const mergeBaseLayoutRef = useRef<LayoutSidecar>(createLayout(initialDocument, "pending"));
  const persistedKeyRef = useRef<string | undefined>(undefined);
  const mutationIdsRef = useRef(new Map<string, string>());
  const publicationIdsRef = useRef(new Map<string, string>());
  const saveGenerationRef = useRef(0);
  const editGeneration = useRef(createEditGeneration());
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
          history.current = new History<EditorSnapshot>({ document: saved.document, layout: nextLayout }, copyEditorSnapshot);
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
  }, [client, definition.id, draftHydrated, document, layout, draftId, saveRetry]);

  const selected = useMemo(() => findSelectedNode(document, selectedId), [document, selectedId]);
  const flowEdges = useMemo(() => toFlowEdges(document), [document]);
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

  const commitSnapshot = useCallback((nextDocument: SemanticDocument, nextLayout: LayoutSidecar): void => {
    editGeneration.current.bump();
    const boundLayout = { ...ensureLayout(nextDocument, nextLayout), semanticDigest: "pending" } as LayoutSidecar;
    history.current.commit({ document: nextDocument, layout: boundLayout });
    setDocument(nextDocument);
    setLayout(boundLayout);
    syncFlowNodes(nextDocument, boundLayout);
    window.setTimeout(() => {
      const nextRawText = JSON.stringify(nextDocument, null, 2);
      setRawText(nextRawText);
      onRawTextChange(definition.id, nextRawText);
    }, 0);
    setRawError(undefined);
    setArchivalImport(undefined);
    setDiagnostics(undefined);
    setValidationState("idle");
  }, [definition.id, ensureLayout, onRawTextChange]);

  const flowProjectionKeyRef = useRef<string>("");
  const syncFlowNodes = useCallback((nextDocument: SemanticDocument, nextLayout: LayoutSidecar, selected: string[] = []): void => {
    const key = `${selected.join(",")}|${nextDocument.graphs.map((graph) => `${graph.id}:${graph.nodes.map((node) => `${node.id}.${node.kind}`).join(",")}`).join("|")}|${Object.entries(nextLayout.positions).map(([id, position]) => `${id}@${position.x},${position.y}`).join(";")}`;
    if (key === flowProjectionKeyRef.current) return;
    flowProjectionKeyRef.current = key;
    setNodes(toFlowNodes(nextDocument, nextLayout, selected));
  }, []);

  const commit = useCallback((nextDocument: SemanticDocument): void => {
    commitSnapshot(nextDocument, layout);
  }, [commitSnapshot, layout]);

  const recoveryStore = useRef(new IndexedDbRecoveryStore());
  const principal = client.principal();
  const recoveryWorkspace = "studio";

  const refreshRecovery = useCallback(async (): Promise<void> => {
    try {
      setRecoveryRecords(await recoveryStore.current.list());
    } catch (error: unknown) {
      setRecoveryRecords([]);
      setRecoveryNotice(error instanceof Error ? error.message : "Local recovery storage is unavailable.");
    }
  }, []);

  useEffect(() => {
    void refreshRecovery();
  }, [refreshRecovery, principal]);

  useEffect(() => {
    if (!recoveryEnabled) return;
    const timer = window.setTimeout(() => {
      let record: RecoveryRecord;
      try {
        record = buildRecoveryRecord({ principal, workspace: recoveryWorkspace, definitionId: definition.id, draftId, document, layout, rawText });
      } catch {
        setRecoveryNotice("Local recovery rejected the candidate; only bounded authoring data is stored.");
        return;
      }
      void recoveryStore.current.put(record).then((result) => {
        setRecoveryNotice(result.prunedForQuota ? "Local recovery storage is full; older records were dropped." : "");
        return refreshRecovery();
      }).catch((error: unknown) => {
        setRecoveryNotice(error instanceof Error ? error.message : "Local recovery write failed.");
      });
    }, 600);
    return () => window.clearTimeout(timer);
  }, [recoveryEnabled, principal, definition.id, draftId, document, layout, rawText, refreshRecovery]);

  const recoverable = useMemo(() => recoverableFor(recoveryRecords, principal, recoveryWorkspace, definition.id), [recoveryRecords, principal, definition.id]);
  const principalRecordCount = recoveryRecords.filter((record) => record.principal === principal).length;

  const recoverLocalCandidate = (): void => {
    if (!recoverable) return;
    commitSnapshot(recoverable.document, recoverable.layout);
    setRawText(recoverable.raw_text ?? JSON.stringify(recoverable.document, null, 2));
    setValidationState("idle");
    setValidationMessage("Recovered an unsaved local candidate; review and validate before saving.");
  };

  const exportRecovery = (): void => {
    const raw = JSON.stringify(recoveryRecords, null, 2);
    const url = URL.createObjectURL(new Blob([raw], { type: "application/json" }));
    const link = window.document.createElement("a");
    link.href = url;
    link.download = `studio-recovery-${principal.replaceAll(/[^A-Za-z0-9._-]/g, "_")}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const clearRecovery = (): void => {
    void recoveryStore.current.clear().then(() => {
      setRecoveryNotice("Local recovery records cleared.");
      return refreshRecovery();
    }).catch((error: unknown) => {
      setRecoveryNotice(error instanceof Error ? error.message : "Local recovery clear failed.");
    });
  };

  const undo = (): void => {
    const next = history.current.undo();
    setDocument(next.document);
    setLayout(next.layout);
    syncFlowNodes(next.document, next.layout);
    setRawText(JSON.stringify(next.document, null, 2));
    setRawError(undefined);
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
    const next = history.current.redo();
    setDocument(next.document);
    setLayout(next.layout);
    syncFlowNodes(next.document, next.layout);
    setRawText(JSON.stringify(next.document, null, 2));
    setRawError(undefined);
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
      const digest = await semanticDigest(bundle.semantic);
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

  const applyBundleImport = (): void => {
    if (!bundleImport) return;
    history.current = new History<EditorSnapshot>({ document: bundleImport.semantic, layout: bundleImport.layout }, copyEditorSnapshot);
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
    if (selected.node.kind === "adaptive_region" && update(selected.node).kind !== "adaptive_region") return;
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

  const reloadRemoteConflict = (): void => {
    const remote = draft.server?.conflict?.serverDocument;
    if (!remote || !draft.server) return;
    const remoteLayoutResult = LayoutSidecarSchema.safeParse(draft.server.conflict?.serverLayout ?? draft.server.layout);
    const remoteLayout = remoteLayoutResult.success ? remoteLayoutResult.data : createLayout(remote, "pending");
    history.current = new History<EditorSnapshot>({ document: remote, layout: remoteLayout }, copyEditorSnapshot);
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
    <RecoveryPanel enabled={recoveryEnabled} principal={principal} count={principalRecordCount} recoverable={recoverable} notice={recoveryNotice} onToggle={() => setRecoveryEnabled((current) => !current)} onRecover={recoverLocalCandidate} onExport={exportRecovery} onClear={clearRecovery} />
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
    {archivalImport ? <ArchivalImportPanel archival={archivalImport} /> : null}
    {bundleImport ? <section className="panel-card bundle-import-preview" aria-label="Imported bundle preview"><div className="panel-title"><div><p className="eyebrow">Digest-bound bundle preview</p><h2>{bundleImport.semantic.workflow_id}@{bundleImport.semantic.version}</h2></div><StatusBadge tone="warning">not applied</StatusBadge></div>
      <dl className="detail-list">
        <div><dt>Semantic digest</dt><dd><code>{bundleImport.digest}</code></dd></div>
        <div><dt>Changed paths</dt><dd>{bundleImport.changedPaths.length}</dd></div>
        <div><dt>Required capabilities</dt><dd>{bundleImport.capabilities.join(", ") || "none"}</dd></div>
      </dl>
      {bundleImport.changedPaths.length ? <ul className="plain-list bundle-diff-list">{bundleImport.changedPaths.slice(0, 12).map((path) => <li key={path}><code>{path}</code></li>)}</ul> : <p className="muted">No semantic differences from the current document.</p>}
      <div className="control-grid"><button className="button button-primary" onClick={applyBundleImport}>Apply imported bundle</button><button className="button button-quiet" onClick={cancelBundleImport}>Cancel import</button></div>
    </section> : null}
    {bundlePreview ? <details className="bundle-preview"><summary>Last portable bundle preview</summary><pre>{bundlePreview}
…</pre></details> : null}
    <GraphNavigator document={document} activeGraphId={activeGraphId} trail={graphTrail} onFocus={focusGraph} onSelectTrail={focusTrailIndex} />
    {tab === "canvas" ? <div className="designer-body">
      <div className="flow-shell" aria-label="Workflow graph canvas">
        <ReactFlow<FlowNode, Edge<{ qualifiedSource: string; qualifiedTarget: string }>>
          key={activeGraphId}
          nodes={visibleNodes}
          edges={visibleEdges}
          defaultViewport={graphViewports[activeGraphId] ?? { x: 0, y: 0, zoom: 1 }}
          onMoveEnd={(_event, viewport) => setGraphViewports((current) => ({ ...current, [activeGraphId]: viewport }))}
          onNodesChange={onNodesChange}
          onConnect={onConnect}
          onNodeClick={(event, node) => selectNode(node.id, event.metaKey || event.ctrlKey)}
          onEdgeClick={onEdgeClick}
          onNodeDragStop={(_event, node) => {
            const nextLayout = updateLayout(layout, { [node.id]: node.position });
            history.current.commit({ document, layout: nextLayout });
            setLayout(nextLayout);
            syncFlowNodes(document, nextLayout);
          }}
          fitView={graphViewports[activeGraphId] === undefined}
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
        <InspectorPanel document={document} catalog={catalog} selected={selected} selectedConfigText={selectedConfigText} onUpdate={updateSelected} onRemove={removeSelected} onNavigateGraph={navigateIntoGraph} />
        {selectedEdge ? <EdgeInspector document={document} selectedEdge={selectedEdge} onReconnect={applyReconnect} /> : null}
      </div>
    </div> : <ListEditor document={document} catalog={catalog} selectedId={selectedId} selectedIds={selectedIds} onSelect={selectNode} onUpdate={updateSelected} onRemove={removeSelected} onNavigateGraph={navigateIntoGraph} />}
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
  document: SemanticDocument;
  catalog: DefinitionRecord[];
  selected: SelectedNode | undefined;
  selectedConfigText: string;
  onUpdate: (update: (node: WorkflowNode) => WorkflowNode) => void;
  onRemove: () => void;
  onNavigateGraph: (graphId: string) => void;
}

function InspectorPanel({ document, catalog, selected, selectedConfigText, onUpdate, onRemove, onNavigateGraph }: InspectorPanelProps): JSX.Element {
  const [configText, setConfigText] = useState(selectedConfigText);
  const [configError, setConfigError] = useState<string | undefined>();
  useEffect(() => setConfigText(selectedConfigText), [selectedConfigText]);
  if (!selected) {
    return <aside className="inspector-panel"><div className="inspector-empty"><span aria-hidden="true">◇</span><strong>Select a node</strong><p>Choose a graph node to inspect its typed fields and safe edit boundary.</p></div></aside>;
  }
  const locked = selected.node.kind === "adaptive_region";
  return <aside className="inspector-panel" aria-label="Node inspector">
    <div className="panel-title"><div><p className="eyebrow">Node inspector</p><h2>{selected.node.id}</h2></div><StatusBadge tone={locked ? "warning" : "success"}>{locked ? "protected region" : selected.node.kind}</StatusBadge></div>
    <label className="field-label">Node kind
      <select value={selected.node.kind} disabled={locked} onChange={(event) => onUpdate((node) => ({ ...node, kind: event.target.value }))}>
        {nodeKinds.map((kind) => <option key={kind} value={kind}>{kind}</option>)}
      </select>
    </label>
    {selected.node.kind === "loop" ? <LoopBodyGraphNavigation document={document} node={selected.node} onNavigateGraph={onNavigateGraph} /> : null}
    {selected.node.kind === "subworkflow" ? <SubworkflowReference node={selected.node} catalog={catalog} disabled={locked} onUpdate={onUpdate} /> : null}
    {locked ? <p className="muted" role="note">Authored region bounds are editable. The generated plan, allowed operations and runtime execution stay read-only and are never applied to an active run.</p> : null}
    <TypedConfigFields node={selected.node} disabled={false} onUpdate={onUpdate} />
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
    {locked ? <Notice tone="warning" title="Protected adaptive region">Publishing creates a new immutable definition for future runs; an active run stays pinned to its original digest. This view never applies a plan to an active run.</Notice> : null}
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
  subworkflow: [],
  adaptive_region: [{ key: "region_id", label: "Protected region", type: "text" }, { key: "max_plan_nodes", label: "Maximum plan nodes", type: "number", min: 1 }, { key: "max_plan_edges", label: "Maximum plan edges", type: "number", min: 1 }, { key: "max_replans", label: "Maximum replans", type: "number", min: 0 }],
  terminal: [{ key: "outcome", label: "Terminal outcome", type: "text" }],
};

function DefinitionControls({ document, onCommit }: { document: SemanticDocument; onCommit: (next: SemanticDocument) => void }): JSX.Element {
  const update = (change: (next: SemanticDocument) => void): void => {
    const next = cloneDocument(document);
    change(next);
    onCommit(next);
  };
  const guardFieldChoices = [...new Set(document.graphs.flatMap((graph) => (graph.guards ?? []).flatMap((guard) => guardReferencedFields(guard.expression))))];
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
      <BoundedNumberField label="Output tokens" value={document.limits.max_output_tokens} min={0} onCommit={(value) => update((next) => { next.limits.max_output_tokens = value; })} />
    </div>
    <div className="guard-editor">
      <div className="panel-title"><div><p className="eyebrow">Typed guards</p><h3>Ordered guard expressions</h3></div><span className="muted">unknown values remain explicit</span></div>
      {document.graphs.map((graph, graphIndex) => <div className="guard-group" key={graph.id}>
        <strong>{graph.id}</strong>
        {(graph.guards ?? []).map((guard, guardIndex) => <GuardField key={guard.id} guard={guard} fieldChoices={guardFieldChoices} onCommit={(nextGuard) => update((next) => { const nextGraph = next.graphs[graphIndex]; nextGraph.guards = [...(nextGraph.guards ?? [])]; nextGraph.guards[guardIndex] = nextGuard; })} />)}
        <button className="button button-quiet" onClick={() => update((next) => { const nextGraph = next.graphs[graphIndex]; nextGraph.guards = [...(nextGraph.guards ?? []), { id: `guard_${(nextGraph.guards?.length ?? 0) + 1}`, expression: { kind: "exists", value: "" } }]; })}>＋ Guard</button>
        <GuardBranches graph={graph} onCommit={(source, branches) => update((next) => {
          const nextGraph = next.graphs[graphIndex];
          const branchIndexes = nextGraph.edges.map((edge, index) => ({ edge, index })).filter(({ edge }) => edge.from === source && isThreeValuedBranch(edge.on)).sort((left, right) => left.edge.priority - right.edge.priority || left.edge.to.localeCompare(right.edge.to) || left.edge.on.localeCompare(right.edge.on));
          branchIndexes.forEach(({ index }, branchIndex) => { nextGraph.edges[index] = branches[branchIndex]; });
        })} />
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
type WorkflowBranch = SemanticDocument["graphs"][number]["edges"][number];

const guardOutcomes = ["true", "false", "unknown"] as const;

type GuardOutcome = typeof guardOutcomes[number];
const guardValueTypes = ["text", "integer", "boolean", "null"] as const;
type GuardValueTypeName = typeof guardValueTypes[number];

function isThreeValuedBranch(outcome: string): outcome is GuardOutcome {
  return guardOutcomes.includes(outcome as GuardOutcome);
}

function currentFieldReference(expression: JsonObject): string {
  const value = expression.value;
  if (typeof value === "string") return value;
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const candidate = (value as JsonObject).left ?? (value as JsonObject).field;
    if (typeof candidate === "string") return candidate;
  }
  return "";
}

function defaultGuardExpression(kind: string, previous: JsonObject): JsonObject {
  const field = currentFieldReference(previous);
  switch (kind) {
    case "exists":
    case "field":
      return { kind, value: field };
    case "literal":
      return { kind, value: encodeGuardValue("text", "value") };
    case "in":
      return { kind, value: { field, values: [encodeGuardValue("text", "value")] } };
    case "add":
      return { kind, value: { left: field, right: 0 } };
    default:
      return { kind, value: { left: field, right: encodeGuardValue("integer", 0) } };
  }
}

function sampleValue(type: GuardValueTypeName, raw: string): JsonValue | undefined {
  if (type === "null") return null;
  if (type === "boolean") return raw === "true" ? true : raw === "false" ? false : undefined;
  if (type === "integer") {
    const parsed = Number(raw);
    return Number.isSafeInteger(parsed) ? parsed : undefined;
  }
  return raw.length > 0 ? raw : undefined;
}

function GuardFieldReference({ guardId, label, value, fieldChoices, onCommit }: { guardId: string; label: string; value: string; fieldChoices: string[]; onCommit: (value: string) => void }): JSX.Element {
  const [draft, setDraft] = useState(value);
  const committed = useRef(value);
  const [error, setError] = useState<string | undefined>();
  useEffect(() => {
    if (committed.current !== value) {
      committed.current = value;
      setDraft(value);
    }
  }, [value]);
  return <label className="field-label">{label}<span className="muted">observation field · unknown when absent</span>
    <input list={`${guardId}-field-choices`} aria-label={`${guardId} observation field`} value={draft} maxLength={128} placeholder="approved.observation.field" onChange={(event) => { setDraft(event.target.value); setError(undefined); }} onBlur={() => {
      const next = draft.trim();
      if (next.length === 0) {
        setError("Select an approved observation field; missing data must remain unknown.");
        return;
      }
      setError(undefined);
      committed.current = next;
      onCommit(next);
    }} />
    <datalist id={`${guardId}-field-choices`}>{fieldChoices.map((field) => <option key={field} value={field} />)}</datalist>
    {error ? <span className="field-error" role="alert">{error}</span> : null}
  </label>;
}

function GuardLiteralEditor({ guardId, label, value, onCommit }: { guardId: string; label: string; value: JsonObject; onCommit: (value: JsonObject) => void }): JSX.Element {
  const incomingKind = guardValueTypes.includes(value.kind as GuardValueTypeName) ? (value.kind as GuardValueTypeName) : "text";
  const [type, setType] = useState<GuardValueTypeName>(incomingKind);
  const [raw, setRaw] = useState(incomingKind === "null" ? "" : String(value.value ?? ""));
  const committed = useRef(JSON.stringify(value));
  useEffect(() => {
    const serialized = JSON.stringify(value);
    if (committed.current !== serialized) {
      committed.current = serialized;
      const nextKind = guardValueTypes.includes(value.kind as GuardValueTypeName) ? (value.kind as GuardValueTypeName) : "text";
      setType(nextKind);
      setRaw(nextKind === "null" ? "" : String(value.value ?? ""));
    }
  }, [value]);
  const commit = (nextType: GuardValueTypeName, nextRaw: string): void => {
    const literal = nextType === "null" ? encodeGuardValue("null", null) : nextType === "boolean" ? (nextRaw === "true" || nextRaw === "false" ? encodeGuardValue("boolean", nextRaw === "true") : undefined) : nextType === "integer" ? (Number.isSafeInteger(Number(nextRaw)) && nextRaw.trim() !== "" ? encodeGuardValue("integer", Number(nextRaw)) : undefined) : nextRaw.length > 0 && nextRaw.length <= 4096 ? encodeGuardValue("text", nextRaw) : undefined;
    if (literal === undefined) return;
    committed.current = JSON.stringify(literal);
    onCommit(literal);
  };
  return <div className="guard-literal"><label className="field-label">Type<select aria-label={`${guardId} ${label} type`} value={type} onChange={(event) => {
    const nextType = event.target.value as GuardValueTypeName;
    setType(nextType);
    const fallback = nextType === "null" ? "" : nextType === "integer" ? "0" : nextType === "boolean" ? "true" : "value";
    setRaw(fallback);
    commit(nextType, fallback);
  }}>{guardValueTypes.map((candidate) => <option key={candidate} value={candidate}>{candidate}</option>)}</select></label>
    {type === "boolean" ? <label className="field-label">Value<select aria-label={`${guardId} ${label} value`} value={raw || "true"} onChange={(event) => { setRaw(event.target.value); commit("boolean", event.target.value); }}><option value="true">true</option><option value="false">false</option></select></label> : <label className="field-label">Value<input aria-label={`${guardId} ${label} value`} value={raw} maxLength={4096} disabled={type === "null"} onChange={(event) => setRaw(event.target.value)} onBlur={() => commit(type, raw)} /></label>}
  </div>;
}

function GuardField({ guard, fieldChoices, onCommit }: { guard: WorkflowGuard; fieldChoices: string[]; onCommit: (guard: WorkflowGuard) => void }): JSX.Element {
  const expression = guard.expression;
  const kind = typeof expression.kind === "string" ? expression.kind : "";
  const spec = guardOperatorSpec(kind);
  const referenced = useMemo(() => guardReferencedFields(expression), [expression]);
  const [samples, setSamples] = useState<Record<string, { type: GuardValueTypeName; value: string }>>({});
  const previewFields = useMemo(() => {
    const map: Record<string, JsonValue | undefined> = {};
    for (const field of referenced) {
      const sample = samples[field];
      if (sample === undefined || sample.value.length === 0) continue;
      const decoded = sampleValue(sample.type, sample.value);
      if (decoded === undefined) continue;
      map[field] = decoded;
    }
    return map;
  }, [referenced, samples]);
  const preview = useMemo(() => evaluateGuard(expression, previewFields), [expression, previewFields]);
  if (!isRegisteredGuardOperator(kind)) {
    return <div className="guard-field"><div className="panel-title"><strong>{guard.id}</strong><span className="muted">read-only · unregistered or nested expression</span></div><pre className="guard-expression-readonly">{JSON.stringify(expression, null, 2)}</pre><p className="field-unknown">This expression is preserved exactly and cannot be edited through the typed builder. Use JSON mode for a deliberate semantic change.</p></div>;
  }
  const operand = expression.value;
  const record = operand !== null && typeof operand === "object" && !Array.isArray(operand) ? operand as JsonObject : {};
  return <div className="guard-field panel-card">
    <div className="panel-title"><strong>{guard.id}</strong><span className="muted">{spec?.summary} · operator {kind}</span></div>
    <label className="field-label">Operator<select aria-label={`${guard.id} operator`} value={kind} onChange={(event) => onCommit({ ...guard, expression: defaultGuardExpression(event.target.value, expression) })}>{GUARD_OPERATORS.map((operator) => <option key={operator.kind} value={operator.kind}>{operator.label}</option>)}</select></label>
    {(kind === "exists" || kind === "field") ? <GuardFieldReference guardId={guard.id} label="Field" value={typeof expression.value === "string" ? expression.value : ""} fieldChoices={fieldChoices} onCommit={(field) => onCommit({ ...guard, expression: { kind, value: field } })} /> : null}
    {kind === "literal" ? <GuardLiteralEditor guardId={guard.id} label="Literal" value={expression.value as JsonObject} onCommit={(literal) => onCommit({ ...guard, expression: { kind: "literal", value: literal } })} /> : null}
    {["equal", "not_equal", "less", "less_or_equal", "greater", "greater_or_equal"].includes(kind) ? <><GuardFieldReference guardId={guard.id} label="Left operand" value={typeof record.left === "string" ? record.left : ""} fieldChoices={fieldChoices} onCommit={(field) => onCommit({ ...guard, expression: { kind, value: { ...record, left: field } } })} /><GuardLiteralEditor guardId={guard.id} label="Right operand" value={(record.right ?? { kind: "text", value: "value" }) as JsonObject} onCommit={(literal) => onCommit({ ...guard, expression: { kind, value: { ...record, right: literal } } })} /></> : null}
    {kind === "add" ? <><GuardFieldReference guardId={guard.id} label="Integer field" value={typeof record.left === "string" ? record.left : ""} fieldChoices={fieldChoices} onCommit={(field) => onCommit({ ...guard, expression: { kind, value: { ...record, left: field } } })} /><label className="field-label">Offset<span className="muted">integer</span><input type="number" aria-label={`${guard.id} add offset`} value={typeof record.right === "number" ? record.right : 0} onChange={(event) => { const offset = Number(event.target.value); if (Number.isSafeInteger(offset)) onCommit({ ...guard, expression: { kind, value: { ...record, right: offset } } }); }} /></label></> : null}
    {kind === "in" ? <><GuardFieldReference guardId={guard.id} label="Field" value={typeof record.field === "string" ? record.field : ""} fieldChoices={fieldChoices} onCommit={(field) => onCommit({ ...guard, expression: { kind, value: { ...record, field } } })} /><label className="field-label">Admitted values<span className="muted">comma separated text literals</span><input aria-label={`${guard.id} admitted values`} value={Array.isArray(record.values) ? record.values.map((entry) => String((entry as JsonObject)?.value ?? "")).join(", ") : ""} onChange={(event) => onCommit({ ...guard, expression: { kind, value: { ...record, values: event.target.value.split(",").map((entry) => entry.trim()).filter((entry) => entry.length > 0).map((entry) => encodeGuardValue("text", entry)) } } })} /></label></> : null}
    <div className="guard-preview" aria-label={`${guard.id} preview`}>
      <div className="panel-title"><strong>Preview</strong><span className="muted">advisory client evaluation of owner semantics</span></div>
      {referenced.length === 0 ? <p className="field-unknown">No observation fields are referenced. Missing data stays unknown.</p> : referenced.map((field) => {
        const sample = samples[field] ?? { type: "text" as GuardValueTypeName, value: "" };
        return <div className="guard-preview-row" key={field}>
          <code>{field}</code>
          <select aria-label={`${guard.id} ${field} sample type`} value={sample.type} onChange={(event) => setSamples((current) => ({ ...current, [field]: { type: event.target.value as GuardValueTypeName, value: event.target.value === "boolean" ? "true" : event.target.value === "null" ? "" : sample.value } }))}>{guardValueTypes.map((candidate) => <option key={candidate} value={candidate}>{candidate}</option>)}</select>
          {sample.type === "boolean" ? <select aria-label={`${guard.id} ${field} sample value`} value={sample.value || "true"} onChange={(event) => setSamples((current) => ({ ...current, [field]: { type: "boolean", value: event.target.value } }))}><option value="true">true</option><option value="false">false</option></select> : <input aria-label={`${guard.id} ${field} sample value`} value={sample.value} disabled={sample.type === "null"} placeholder="leave blank to stay unknown" onChange={(event) => setSamples((current) => ({ ...current, [field]: { type: sample.type, value: event.target.value } }))} />}
        </div>;
      })}
      <output className={`guard-truth guard-truth-${preview}`} aria-label={`${guard.id} preview result`} data-testid={`guard-preview-result-${guard.id}`} data-truth={preview}>{preview}</output>
    </div>
  </div>;
}

function GuardBranches({ graph, onCommit }: { graph: SemanticDocument["graphs"][number]; onCommit: (source: string, branches: WorkflowBranch[]) => void }): JSX.Element {
  const branchSources = [...new Set(graph.edges.filter((edge) => isThreeValuedBranch(edge.on)).map((edge) => edge.from))];
  if (branchSources.length === 0) return <p className="field-unknown">No true/false/unknown branches are defined in this graph.</p>;
  return <div className="guard-branches" aria-label={`${graph.id} guard branches`}>
    {branchSources.map((source) => {
      const branches = graph.edges.filter((edge) => edge.from === source && isThreeValuedBranch(edge.on)).sort((left, right) => left.priority - right.priority || left.to.localeCompare(right.to) || left.on.localeCompare(right.on));
      const missing = guardOutcomes.filter((outcome) => !branches.some((branch) => branch.on === outcome));
      const duplicatePriorities = new Set(branches.map((branch) => branch.priority)).size !== branches.length;
      const move = (from: number, to: number): void => {
        if (to < 0 || to >= branches.length) return;
        const reordered = branches.slice();
        const [moved] = reordered.splice(from, 1);
        reordered.splice(to, 0, moved);
        const base = branches.reduce((minimum, branch) => Math.min(minimum, branch.priority), Number.MAX_SAFE_INTEGER);
        onCommit(source, reordered.map((branch, index) => ({ ...branch, priority: base + index })));
      };
      return <section className="guard-branch-group" key={source} aria-label={`${source} branches`}>
        <div><strong>{source}</strong><span className="muted">owner order: lowest priority first, then target id</span></div>
        {duplicatePriorities ? <p className="field-unknown" role="status">Tied priorities resolve by target id in the owner compiler; reordering rewrites priorities so the displayed order becomes authoritative.</p> : null}
        {branches.map((branch, index) => <div className="guard-branch-row" key={`${index}:${branch.to}:${branch.on}`}>
          <label className="field-label">Outcome<select aria-label={`${source} branch ${index + 1} outcome`} value={branch.on} onChange={(event) => {
            const outcome = event.target.value;
            if (!isThreeValuedBranch(outcome)) return;
            onCommit(source, branches.map((candidate, candidateIndex) => candidateIndex === index ? { ...candidate, on: outcome } : candidate));
          }}>{guardOutcomes.map((outcome) => <option key={outcome} value={outcome}>{outcome}</option>)}</select></label>
          <label className="field-label">Target<select aria-label={`${source} branch ${index + 1} target`} value={branch.to} onChange={(event) => onCommit(source, branches.map((candidate, candidateIndex) => candidateIndex === index ? { ...candidate, to: event.target.value } : candidate))}>{graph.nodes.map((node) => <option key={node.id} value={node.id}>{node.id}</option>)}</select></label>
          <span className="branch-priority">priority {branch.priority} · {branch.on}</span>
          <div className="branch-actions"><button className="button button-quiet" aria-label={`Move ${branch.on} branch earlier`} disabled={index === 0} onClick={() => move(index, index - 1)}>↑</button><button className="button button-quiet" aria-label={`Move ${branch.on} branch later`} disabled={index === branches.length - 1} onClick={() => move(index, index + 1)}>↓</button></div>
        </div>)}
        {missing.length ? <p className="field-error" role="alert">Missing explicit exits: {missing.join(", ")}. Unknown must route explicitly.</p> : null}
      </section>;
    })}
  </div>;
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
  catalog: DefinitionRecord[];
  selectedId: string | undefined;
  selectedIds: string[];
  onSelect: (id: string, additive?: boolean) => void;
  onUpdate: (update: (node: WorkflowNode) => WorkflowNode) => void;
  onRemove: () => void;
  onNavigateGraph: (graphId: string) => void;
}

function RecoveryPanel({ enabled, principal, count, recoverable, notice, onToggle, onRecover, onExport, onClear }: { enabled: boolean; principal: string; count: number; recoverable: RecoveryRecord | undefined; notice: string; onToggle: () => void; onRecover: () => void; onExport: () => void; onClear: () => void }): JSX.Element {
  return <section className="recovery-panel panel-card" aria-label="Local crash recovery">
    <div className="panel-title"><div><p className="eyebrow">Optional local recovery</p><h2>Crash-recovery buffer</h2></div><StatusBadge tone={enabled ? "success" : "muted"}>{enabled ? "on" : "off"}</StatusBadge></div>
    <p className="muted">Sanitized authoring data only (document, layout, raw text) with a 24-hour TTL, bound to principal <code>{principal}</code>. Tokens, live run snapshots, provider outputs and commands are never stored.</p>
    <div className="control-grid">
      <button className="button button-quiet" onClick={onToggle}>{enabled ? "Disable recovery" : "Enable recovery"}</button>
      <button className="button button-secondary" onClick={onRecover} disabled={!recoverable}>Recover unsaved candidate</button>
      <button className="button button-quiet" onClick={onExport} disabled={count === 0}>Export recovery</button>
      <button className="button button-quiet" onClick={onClear} disabled={count === 0}>Clear local recovery</button>
    </div>
    <p className="muted">Stored records for this principal: {count}{recoverable ? ` · recoverable from ${recoverable.saved_at}` : ""}</p>
    {notice ? <p className="field-unknown" role="status">{notice}</p> : null}
  </section>;
}

function GraphNavigator({ document, activeGraphId, trail, onFocus, onSelectTrail }: { document: SemanticDocument; activeGraphId: string; trail: string[]; onFocus: (graphId: string) => void; onSelectTrail: (index: number) => void }): JSX.Element {
  return <nav className="graph-nav panel-card" aria-label="Workflow graph navigation">
    <div className="graph-nav-row">
      <span className="eyebrow">Breadcrumbs</span>
      <ol className="graph-breadcrumbs" aria-label="Graph breadcrumb trail">
        {trail.map((graphId, index) => <li key={`${graphId}-${index}`}>{index > 0 ? <span className="graph-crumb-separator" aria-hidden="true">›</span> : null}{index === trail.length - 1 ? <span className="graph-crumb-current" aria-current="page">{graphId}</span> : <button className="graph-crumb" onClick={() => onSelectTrail(index)}>{graphId}</button>}</li>)}
      </ol>
    </div>
    <div className="graph-nav-row">
      <span className="eyebrow">Graphs</span>
      <div className="graph-switcher" role="group" aria-label="All workflow graphs">
        {document.graphs.map((graph) => <button key={graph.id} className={`button ${graph.id === activeGraphId ? "button-secondary" : "button-quiet"}`} aria-pressed={graph.id === activeGraphId} onClick={() => onFocus(graph.id)}>{graph.id}</button>)}
      </div>
    </div>
    <p className="graph-nav-note">Graphs are navigated one at a time; this list is not execution ordering or parallelism.</p>
  </nav>;
}

function LoopBodyGraphNavigation({ document, node, onNavigateGraph }: { document: SemanticDocument; node: WorkflowNode; onNavigateGraph: (graphId: string) => void }): JSX.Element | null {
  const bodyGraph = node.config.body_graph;
  if (typeof bodyGraph !== "string" || !document.graphs.some((graph) => graph.id === bodyGraph)) return null;
  return <div className="nested-graph-action"><span className="muted">Bounded loop body</span><button className="button button-secondary" onClick={() => onNavigateGraph(bodyGraph)}>Open body graph: {bodyGraph}</button></div>;
}

function PinnedRefField({ label, value, disabled, onCommit }: { label: string; value: unknown; disabled: boolean; onCommit: (next: string) => void }): JSX.Element {
  const current = typeof value === "string" ? value : "";
  const [draft, setDraft] = useState(current);
  const committed = useRef(current);
  const [error, setError] = useState<string | undefined>();
  useEffect(() => {
    if (committed.current !== current) {
      committed.current = current;
      setDraft(current);
    }
  }, [current]);
  return <label className="field-label">{label}<span className="muted">pinned reference</span>
    <input value={draft} maxLength={256} disabled={disabled} onChange={(event) => { setDraft(event.target.value); setError(undefined); }} onBlur={() => {
      if (draft.trim().length === 0) {
        setError("A pinned subworkflow reference requires this value.");
        return;
      }
      setError(undefined);
      committed.current = draft;
      onCommit(draft);
    }} />
    {error ? <span className="field-error" role="alert">{error}</span> : null}
  </label>;
}

function SubworkflowReference({ node, catalog, disabled, onUpdate }: { node: WorkflowNode; catalog: DefinitionRecord[]; disabled: boolean; onUpdate: InspectorPanelProps["onUpdate"] }): JSX.Element {
  const [inspecting, setInspecting] = useState(false);
  const raw = node.config.artifact_ref;
  const ref = raw !== null && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, JsonValue> : {};
  const resolution = resolveSubworkflowReference(catalog, node.config);
  const resolutionTone = resolution.status === "resolved" ? (resolution.digestVerified ? "success" : "warning") : "danger";
  const update = (key: string, value: string): void => {
    onUpdate((candidate) => ({ ...candidate, config: { ...candidate.config, artifact_ref: { ...ref, [key]: value } } }));
  };
  return <div className="subworkflow-reference" aria-label="Pinned subworkflow reference">
    <div className="panel-title"><strong>Pinned subworkflow</strong><span className="ref-badges"><span className="ref-badge">v{typeof ref.version === "string" && ref.version ? ref.version : "unset"}</span><span className="ref-badge" title={typeof ref.digest === "string" ? ref.digest : undefined}>{typeof ref.digest === "string" && ref.digest ? `${ref.digest.slice(0, 12)}…` : "no digest"}</span></span></div>
    <PinnedRefField label="Reference id" value={ref.id} disabled={disabled} onCommit={(value) => update("id", value)} />
    <PinnedRefField label="Reference version" value={ref.version} disabled={disabled} onCommit={(value) => update("version", value)} />
    <PinnedRefField label="Reference digest" value={ref.digest} disabled={disabled} onCommit={(value) => update("digest", value)} />
    <div className="reference-resolution" aria-label="Pinned reference resolution" data-status={resolution.status}>
      <StatusBadge tone={resolutionTone}>{resolution.status === "resolved" ? (resolution.digestVerified ? "resolved" : "resolved · digest unverified") : "unavailable"}</StatusBadge>
      <span>{resolution.message}</span>
    </div>
    <p className="muted reference-bindings">Phase 1 admits only this exact pinned reference; typed input/output bindings are not yet supported and no floating latest reference is used.</p>
    <button className="button button-quiet" onClick={() => setInspecting((current) => !current)}>{inspecting ? "Close reference note" : "Inspect reference"}</button>
    {inspecting ? <Notice tone="warning" title="Library reference">This node pins an immutable library artifact by version and digest. Editing the shared definition requires an intentional fork or a new version; this Studio changes only the pinned reference.</Notice> : null}
  </div>;
}

function ListEditor({ document, catalog, selectedId, selectedIds, onSelect, onUpdate, onRemove, onNavigateGraph }: ListEditorProps): JSX.Element {
  const selected = findSelectedNode(document, selectedId);
  return <div className="list-editor">
    <div className="list-editor-main">
      <div className="panel-title"><div><p className="eyebrow">Equivalent editor</p><h2>Semantic node list</h2></div><span className="muted">Keyboard friendly</span></div>
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
    <InspectorPanel document={document} catalog={catalog} selected={selected} selectedConfigText={selected ? JSON.stringify(selected.node.config, null, 2) : ""} onUpdate={onUpdate} onRemove={onRemove} onNavigateGraph={onNavigateGraph} />
  </div>;
}

function DiagnosticsPanel({ result, onFocusPath }: { result: ValidateResponse; onFocusPath: (path: string) => void }): JSX.Element {
  return <div className={`diagnostics-panel ${result.valid ? "diagnostics-valid" : "diagnostics-invalid"}`}>
    <div className="panel-title"><div><p className="eyebrow">Owner validation</p><h2>{result.valid ? "Definition admitted" : "Definition needs attention"}</h2></div><span className="validation-identity"><code>{result.definition_digest.slice(0, 16)}…</code>{result.compiler ? <code className="compile-identity">compiler {result.compiler}</code> : null}</span></div>
    {result.diagnostics.length === 0 ? <p className="muted">No diagnostics returned by the active adapter.</p> : <ul className="diagnostics-list">{result.diagnostics.map((diagnostic, index) => <li key={`${diagnostic.code}-${index}`}><StatusBadge tone={diagnostic.severity === "error" ? "danger" : diagnostic.severity === "warning" ? "warning" : "muted"}>{diagnostic.severity}</StatusBadge><button className="diagnostic-target" onClick={() => onFocusPath(diagnostic.path)} aria-label={`Focus diagnostic ${diagnostic.path}`}><code>{diagnostic.path}</code></button><span>{diagnostic.message}</span></li>)}</ul>}
  </div>;
}

const nodeKinds = ["observe", "decide", "execute_action", "route", "loop", "subworkflow", "adaptive_region", "terminal"];

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
