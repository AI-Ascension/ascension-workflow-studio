import {
  type ChangeEvent,
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
  type DefinitionRecord,
  type LayoutSidecar,
  type ValidateResponse,
  type WorkflowDefinition,
  type WorkflowNode,
} from "@studio/contracts";
import { CapabilityGateError, type StudioClient } from "@studio/client";
import {
  History,
  addEdge,
  addNode,
  createFlowProjection,
  createLayout,
  layoutIsValid,
  removeNode,
  parseStudioBundle,
  serializeStudioBundle,
  updateLayout,
  updateNode,
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
  mode: "fixture" | "live";
  onBack: () => void;
  onRun: (document: WorkflowDefinition) => void;
}

interface DraftState {
  revision: number;
  etag: string;
  state: "saved" | "saving" | "offline" | "conflict";
  message: string;
}

export function DesignerView({ client, definition, initialDocument, mode, onBack, onRun }: DesignerViewProps): JSX.Element {
  const [document, setDocument] = useState<SemanticDocument>(() => initialDocument);
  const [layout, setLayout] = useState<LayoutSidecar>(() => createLayout(initialDocument, "pending"));
  const [nodes, setNodes] = useState<FlowNode[]>(() => toFlowNodes(initialDocument, createLayout(initialDocument, "pending")));
  const [tab, setTab] = useState<EditorTab>("canvas");
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [diagnostics, setDiagnostics] = useState<ValidateResponse | undefined>();
  const [validationState, setValidationState] = useState<"idle" | "running" | "valid" | "invalid" | "error">("idle");
  const [validationMessage, setValidationMessage] = useState("");
  const [draft, setDraft] = useState<DraftState>({ revision: 0, etag: "fixture-0", state: "saved", message: "Draft changes are local until autosave completes." });
  const history = useRef(new History(initialDocument, (value) => JSON.parse(JSON.stringify(value)) as WorkflowDefinition));
  const bundleInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const nextLayout = createLayout(initialDocument, "pending");
    history.current = new History(initialDocument, (value) => JSON.parse(JSON.stringify(value)) as WorkflowDefinition);
    setDocument(initialDocument);
    setLayout(nextLayout);
    setNodes(toFlowNodes(initialDocument, nextLayout));
    setSelectedId(undefined);
    setDiagnostics(undefined);
    setValidationState("idle");
    setDraft({ revision: 0, etag: "fixture-0", state: "saved", message: "Draft changes are local until autosave completes." });
  }, [initialDocument]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDraft((current) => ({ ...current, state: "saving", message: "Saving draft through the owner adapter…" }));
      void client.saveDraft({
        draftId: `draft.${definition.id}`,
        definitionId: definition.id,
        revision: draft.revision + 1,
        etag: draft.etag,
        document,
      }).then((saved) => {
        setDraft({ revision: saved.revision, etag: saved.etag, state: saved.conflict ? "conflict" : "saved", message: saved.conflict ? "The owner reported a revision conflict." : "Autosaved to the active adapter." });
      }).catch((error: unknown) => {
        if (error instanceof CapabilityGateError) {
          setDraft((current) => ({ ...current, state: "offline", message: "Live draft persistence is not in the admitted Phase 1 surface; changes remain in this editor." }));
        } else {
          setDraft((current) => ({ ...current, state: "offline", message: error instanceof Error ? error.message : "Draft save failed." }));
        }
      });
    }, 700);
    return () => window.clearTimeout(timer);
  }, [client, definition.id, document]);

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
    history.current.commit(nextDocument);
    setDocument(nextDocument);
    setLayout(nextLayout);
    setNodes(toFlowNodes(nextDocument, nextLayout));
    setDiagnostics(undefined);
    setValidationState("idle");
  }, [ensureLayout, layout]);

  const undo = (): void => {
    const next = history.current.undo();
    const nextLayout = { ...ensureLayout(next, layout), semanticDigest: "pending" } as LayoutSidecar;
    setDocument(next);
    setLayout(nextLayout);
    setNodes(toFlowNodes(next, nextLayout));
  };

  const redo = (): void => {
    const next = history.current.redo();
    const nextLayout = { ...ensureLayout(next, layout), semanticDigest: "pending" } as LayoutSidecar;
    setDocument(next);
    setLayout(nextLayout);
    setNodes(toFlowNodes(next, nextLayout));
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

  const addNewNode = (): void => {
    const graph = document.graphs[0];
    if (!graph) return;
    const id = nextNodeId(graph.nodes.map((node) => node.id));
    const node: WorkflowNode = { id, kind: "observe", config: { projection_ref: "studio.new" } };
    commit(addNode(document, graph.id, node));
    setSelectedId(`${graph.id}:${id}`);
  };

  const exportBundle = async (): Promise<void> => {
    try {
      const raw = await serializeStudioBundle({ semantic: document, layout });
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
    try {
      const bundle = await parseStudioBundle(await file.text());
      history.current = new History(bundle.semantic, (value) => JSON.parse(JSON.stringify(value)) as WorkflowDefinition);
      setDocument(bundle.semantic);
      setLayout(bundle.layout);
      setNodes(toFlowNodes(bundle.semantic, bundle.layout));
      setSelectedId(undefined);
      setDiagnostics(undefined);
      setValidationState("valid");
      setValidationMessage("Imported and verified a digest-bound Studio bundle.");
    } catch (error: unknown) {
      setValidationState("error");
      setValidationMessage(error instanceof Error ? error.message : "Bundle import failed.");
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
    } catch (error: unknown) {
      setValidationMessage(error instanceof Error ? error.message : "Node could not be removed.");
      setValidationState("error");
    }
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
        <button className="button button-secondary" onClick={() => void validate()} disabled={validationState === "running"}>◈ Validate</button>
        <button className="button button-primary" onClick={() => onRun(document)}>Run inspection</button>
      </div>
    </div>
    <div className="designer-status-row">
      <span className="muted">Layout binding: <strong>{layoutState}</strong></span>
      <span className="muted">{draft.message}</span>
      {validationMessage ? <span className={`validation-label validation-${validationState}`}>{validationMessage}</span> : null}
    </div>
    {draft.state === "conflict" ? <Notice tone="danger" title="Draft conflict">The server revision changed while this editor was saving. Review the conflict before publishing.</Notice> : null}
    <div className="designer-toolbar" role="toolbar" aria-label="Designer tools">
      <div className="segmented-control" role="tablist" aria-label="Editor surface">
        <button className={tab === "canvas" ? "active" : ""} onClick={() => setTab("canvas")} role="tab" aria-selected={tab === "canvas"}>Canvas</button>
        <button className={tab === "list" ? "active" : ""} onClick={() => setTab("list")} role="tab" aria-selected={tab === "list"}>List editor</button>
      </div>
      <div className="toolbar-actions">
        <button className="button button-quiet" onClick={undo} disabled={!history.current.canUndo()}>Undo</button>
        <button className="button button-quiet" onClick={redo} disabled={!history.current.canRedo()}>Redo</button>
        <button className="button button-secondary" onClick={addNewNode}>＋ Node</button>
        <button className="button button-quiet" onClick={() => void exportBundle()}>Export</button>
        <button className="button button-quiet" onClick={() => bundleInput.current?.click()}>Import</button>
        <input ref={bundleInput} className="sr-only" type="file" accept="application/json,.json" onChange={(event) => void importBundle(event)} />
      </div>
    </div>
    {tab === "canvas" ? <div className="designer-body">
      <div className="flow-shell" aria-label="Workflow graph canvas">
        <ReactFlow<FlowNode, Edge<{ qualifiedSource: string; qualifiedTarget: string }>>
          nodes={nodes}
          edges={flowEdges}
          onNodesChange={onNodesChange}
          onConnect={onConnect}
          onNodeClick={(_event, node) => setSelectedId(node.id)}
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
      <InspectorPanel selected={selected} selectedConfigText={selectedConfigText} onUpdate={updateSelected} onRemove={removeSelected} />
    </div> : <ListEditor document={document} selectedId={selectedId} onSelect={setSelectedId} onUpdate={updateSelected} onRemove={removeSelected} />}
    {diagnostics ? <DiagnosticsPanel result={diagnostics} /> : null}
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

interface ListEditorProps {
  document: SemanticDocument;
  selectedId: string | undefined;
  onSelect: (id: string) => void;
  onUpdate: (update: (node: WorkflowNode) => WorkflowNode) => void;
  onRemove: () => void;
}

function ListEditor({ document, selectedId, onSelect, onUpdate, onRemove }: ListEditorProps): JSX.Element {
  const selected = findSelectedNode(document, selectedId);
  return <div className="list-editor">
    <div className="list-editor-main">
      <div className="panel-title"><div><p className="eyebrow">Equivalent editor</p><h2>Semantic node list</h2></div><span className="muted">Keyboard friendly</span></div>
      {document.graphs.map((graph) => <div className="graph-list" key={graph.id}>
        <div className="graph-list-title"><span>{graph.id}</span><span className="muted">entry: {graph.entry_node}</span></div>
        {graph.nodes.map((node) => {
          const id = `${graph.id}:${node.id}`;
          return <button className={`node-list-row ${selectedId === id ? "selected" : ""}`} key={id} onClick={() => onSelect(id)}>
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

function DiagnosticsPanel({ result }: { result: ValidateResponse }): JSX.Element {
  return <div className={`diagnostics-panel ${result.valid ? "diagnostics-valid" : "diagnostics-invalid"}`}>
    <div className="panel-title"><div><p className="eyebrow">Owner validation</p><h2>{result.valid ? "Definition admitted" : "Definition needs attention"}</h2></div><code>{result.definition_digest.slice(0, 16)}…</code></div>
    {result.diagnostics.length === 0 ? <p className="muted">No diagnostics returned by the active adapter.</p> : <ul className="diagnostics-list">{result.diagnostics.map((diagnostic, index) => <li key={`${diagnostic.code}-${index}`}><StatusBadge tone={diagnostic.severity === "error" ? "danger" : diagnostic.severity === "warning" ? "warning" : "muted"}>{diagnostic.severity}</StatusBadge><code>{diagnostic.path}</code><span>{diagnostic.message}</span></li>)}</ul>}
  </div>;
}

const nodeKinds = ["observe", "decide", "execute_action", "route", "loop", "adaptive_region", "terminal"];

function toFlowNodes(document: SemanticDocument, layout: LayoutSidecar): FlowNode[] {
  return createFlowProjection({ semantic: document, layout }).nodes.map((node) => ({
    id: node.id,
    position: node.position,
    data: node.data,
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
