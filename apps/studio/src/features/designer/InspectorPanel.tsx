import { useEffect, useRef, useState } from "react";

import {
  JsonObjectSchema,
  formatInferenceProfilePin,
  type ContextBinding,
  type DefinitionRecord,
  type InferenceProfileCatalog,
  type InferenceProfileRejection,
  type JsonObject,
  type JsonValue,
  type WorkflowNode,
  inferenceProfilesForNodeKind,
  parseInferenceProfilePin,
  resolveInferenceProfile,
} from "@studio/contracts";
import {
  OWNER_NODE_KINDS,
  compatibleNodeOutputs,
  convertNodeKind,
  diffDocuments,
  nodeOutputs,
  resolveSubworkflowReference,
  validateNodeBindings,
  type SemanticDocument,
} from "@studio/document";
import { beginBenchmarkEdit, endBenchmarkEdit, recordBenchmarkHandler } from "../benchmark/benchmark";

import { Notice } from "../../components/Notice";
import { StatusBadge } from "../../components/StatusBadge";

export interface SelectedNode {
  graphId: string;
  node: WorkflowNode;
}

function formatConversionValue(value: JsonValue | undefined): string {
  if (value === undefined) return "∅";
  const serialized = JSON.stringify(value);
  return serialized === undefined ? "∅" : serialized;
}

interface InspectorPanelProps {
  document: SemanticDocument;
  catalog: DefinitionRecord[];
  contextBindings?: ContextBinding[];
  /** The owner catalog. Absent or non-available means NOTHING is selectable;
   * no fixture is substituted here. */
  inferenceProfiles?: InferenceProfileCatalog;
  selected: SelectedNode | undefined;
  selectedConfigText: string;
  onUpdate: (update: (node: WorkflowNode) => WorkflowNode) => void;
  onRemove: () => void;
  onNavigateGraph: (graphId: string) => void;
}

export function InspectorPanel({ document, catalog, contextBindings, inferenceProfiles, selected, selectedConfigText, onUpdate, onRemove, onNavigateGraph }: InspectorPanelProps): JSX.Element {
  const [configText, setConfigText] = useState(selectedConfigText);
  const [configError, setConfigError] = useState<string | undefined>();
  const [pendingKind, setPendingKind] = useState<string | undefined>();
  useEffect(() => setConfigText(selectedConfigText), [selectedConfigText]);
  useEffect(() => setPendingKind(undefined), [selected?.graphId, selected?.node.id, selected?.node.kind]);
  if (!selected) {
    return <aside className="inspector-panel"><div className="inspector-empty"><span aria-hidden="true">◇</span><strong>Select a node</strong><p>Choose a graph node to inspect its typed fields and safe edit boundary.</p></div></aside>;
  }
  const locked = selected.node.kind === "adaptive_region";
  const graph = document.graphs.find((candidate) => candidate.id === selected.graphId);
  const pendingNode = pendingKind && graph ? (() => {
    try { return convertNodeKind(selected.node, pendingKind, graph); } catch { return undefined; }
  })() : undefined;
  const removedFields = pendingNode ? Object.keys(selected.node.config).filter((key) => !(key in pendingNode.config)) : [];
  const conversionChanges = pendingNode ? diffDocuments(selected.node.config, pendingNode.config, "config") : [];
  const pendingDocument = pendingNode && graph ? {
    ...document,
    graphs: document.graphs.map((candidate) => candidate.id !== graph.id ? candidate : {
      ...candidate,
      nodes: candidate.nodes.map((candidateNode) => candidateNode.id === selected.node.id ? pendingNode : candidateNode),
    }),
  } : undefined;
  const pendingBindingIssues = pendingDocument
    ? validateNodeBindings(pendingDocument).filter((issue) => issue.graphId === selected.graphId && issue.nodeId === selected.node.id)
    : [];
  return <aside className="inspector-panel" aria-label="Node inspector">
    <div className="panel-title"><div><p className="eyebrow">Node inspector</p><h2>{selected.node.id}</h2></div><StatusBadge tone={locked ? "warning" : "success"}>{locked ? "protected region" : selected.node.kind}</StatusBadge></div>
    <label className="field-label">Node kind
      <select value={pendingKind ?? selected.node.kind} disabled={locked} onChange={(event) => {
        const editStart = beginBenchmarkEdit();
        const nextKind = event.target.value;
        setPendingKind(nextKind === selected.node.kind ? undefined : nextKind);
        // A kind selection first opens the explicit conversion preview. Keep
        // the benchmark's input-to-paint sample attached to that visible edit
        // even though the semantic commit waits for confirmation.
        recordBenchmarkHandler(editStart);
        endBenchmarkEdit(editStart);
      }}>
        {OWNER_NODE_KINDS.map((kind) => <option key={kind} value={kind}>{kind}</option>)}
      </select>
    </label>
    {pendingNode ? <section className="kind-conversion-preview" aria-label="Node kind conversion preview">
      <strong>Kind conversion preview</strong>
      <p className="muted">Changing {selected.node.kind} to {pendingNode.kind} replaces its configuration with the fields admitted for the new kind. Undo restores the complete prior node.</p>
      {removedFields.length ? <p className="field-unknown">Fields removed: <code>{removedFields.join(", ")}</code></p> : <p className="muted">No existing configuration fields overlap the new kind.</p>}
      {conversionChanges.length ? <ul className="plain-list kind-conversion-diff" aria-label="Kind conversion diff">
        {conversionChanges.slice(0, 24).map((change, index) => <li key={`${change.path}-${index}`}><code>{change.path}</code> <span className="muted">{formatConversionValue(change.before)} → {formatConversionValue(change.after)}</span></li>)}
      </ul> : null}
      {pendingBindingIssues.length ? <p className="field-error" role="alert">This conversion needs a compatible owner binding before validation: {pendingBindingIssues.map((issue) => issue.message).join(" ")}</p> : null}
      <div className="control-grid"><button className="button button-primary" onClick={() => { onUpdate(() => pendingNode); setPendingKind(undefined); }}>Apply kind change</button><button className="button button-quiet" onClick={() => setPendingKind(undefined)}>Cancel kind change</button></div>
    </section> : null}
    {selected.node.kind === "loop" ? <LoopBodyGraphNavigation document={document} node={selected.node} onNavigateGraph={onNavigateGraph} /> : null}
    {selected.node.kind === "subworkflow" ? <SubworkflowReference node={selected.node} catalog={catalog} disabled={locked} onUpdate={onUpdate} /> : null}
    {locked ? <p className="muted" role="note">Authored region bounds are editable. The generated plan, allowed operations and runtime execution stay read-only and are never applied to an active run.</p> : null}
    <TypedConfigFields document={document} graphId={selected.graphId} node={selected.node} disabled={false} contextBindings={contextBindings} inferenceProfiles={inferenceProfiles} onUpdate={onUpdate} />
    <label className="field-label">Configuration <span className="muted">JSON object</span>
      <textarea value={configText} disabled={locked || Boolean(pendingNode)} rows={12} onChange={(event) => { setConfigText(event.target.value); setConfigError(undefined); }} onBlur={() => {
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
  document: SemanticDocument;
  graphId: string;
  node: WorkflowNode;
  disabled: boolean;
  contextBindings?: ContextBinding[];
  inferenceProfiles?: InferenceProfileCatalog;
  onUpdate: (update: (node: WorkflowNode) => WorkflowNode) => void;
}

function TypedConfigFields({ document, graphId, node, disabled, contextBindings, inferenceProfiles, onUpdate }: TypedConfigFieldsProps): JSX.Element {
  const fields = typedFieldsByKind[node.kind] ?? [];
  const contextOptions = contextBindings?.filter((binding) => binding.node_kinds.includes(node.kind as "analyze" | "decide")).map((binding) => binding.context_ref) ?? [];
  // The node's own `context_ref`, when it declares one, is what the owner
  // admits context compatibility against. Passing it makes a
  // context-incompatible profile refuse here instead of at run admission.
  const contextRef = typeof node.config.context_ref === "string" ? node.config.context_ref : undefined;
  const operationOptions = [...new Set(document.graphs.flatMap((graph) => graph.nodes.flatMap((candidate) => {
    const allowed = candidate.kind === "adaptive_region" ? candidate.config.allowed_operations : undefined;
    return Array.isArray(allowed) ? allowed.filter((value): value is string => typeof value === "string") : [];
  })) )];
  return <div className="typed-config-fields" aria-label="Typed node fields">
    <p className="eyebrow">Typed fields</p>
    {fields.map((field) => field.profileField
      ? <InferenceProfileSelectField key={field.key} node={node} fieldKey={field.key} label={field.label} catalog={inferenceProfiles} contextRef={contextRef} disabled={disabled} onUpdate={onUpdate} />
      : <TypedConfigField key={field.key} node={node} field={field} disabled={disabled} onUpdate={onUpdate} />)}
    {node.kind === "analyze" ? <ReferenceSelectField node={node} fieldKey="context_ref" label="Analysis context" options={contextOptions} disabled={disabled} onUpdate={onUpdate} /> : null}
    {node.kind === "decide" ? <ReferenceSelectField node={node} fieldKey="context_ref" label="Decision context" options={contextOptions} disabled={disabled} onUpdate={onUpdate} /> : null}
    {node.kind === "adaptive_region" ? <AllowedOperationsField node={node} options={operationOptions} disabled={disabled} onUpdate={onUpdate} /> : null}
    {node.kind === "adaptive_region" ? <TypedConfigSelectField node={node} fieldKey="output_type" label="Adaptive output type" options={["DecisionProposal"]} disabled={true} onUpdate={onUpdate} /> : null}
    {node.kind === "execute_action" ? <ProposalBindingField document={document} graphId={graphId} node={node} requiredType="DecisionProposal" label="Action proposal source" disabled={disabled} onUpdate={onUpdate} /> : null}
    {node.kind === "emit_artifact" ? <ProposalBindingField document={document} graphId={graphId} node={node} requiredType="any" label="Artifact input source" disabled={disabled} onUpdate={onUpdate} /> : null}
    {node.kind === "terminal" ? <TypedConfigSelectField node={node} fieldKey="outcome" label="Terminal outcome" options={["completed", "failed", "needs_operator"]} disabled={disabled} onUpdate={onUpdate} /> : null}
    {fields.length === 0 && node.kind !== "execute_action" && node.kind !== "emit_artifact" && node.kind !== "terminal" && node.kind !== "adaptive_region" ? <p className="field-unknown">No admitted typed form for this node kind. Use bounded JSON mode.</p> : null}
  </div>;
}
interface TypedConfigFieldDefinition {
  key: string;
  label: string;
  type: "text" | "number";
  min?: number;
  max?: number;
  /** Renders a capability-aware owner-catalog select and an exact
   * `id:version:digest` pin instead of free text. */
  profileField?: boolean;
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
        if (!Number.isSafeInteger(value) || (field.min !== undefined && value < field.min) || (field.max !== undefined && value > field.max)) {
          setError(`Enter a safe integer${field.min === undefined ? "" : ` ≥ ${field.min}`}${field.max === undefined ? "" : ` and ≤ ${field.max}`}.`);
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

function TypedConfigSelectField({ node, fieldKey, label, options, disabled, onUpdate }: { node: WorkflowNode; fieldKey: string; label: string; options: string[]; disabled: boolean; onUpdate: TypedConfigFieldsProps["onUpdate"] }): JSX.Element {
  const current = typeof node.config[fieldKey] === "string" ? node.config[fieldKey] as string : options[0];
  return <label className="field-label">{label}<span className="muted">owner enum</span><select aria-label={`${node.id} ${label}`} value={current} disabled={disabled} onChange={(event) => onUpdate((candidate) => ({ ...candidate, config: { ...candidate.config, [fieldKey]: event.target.value } }))}>{options.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>;
}
const typedFieldsByKind: Record<string, TypedConfigFieldDefinition[]> = {
  observe: [{ key: "projection_ref", label: "Projection reference", type: "text" }],
  await_stability: [{ key: "deadline_ms", label: "Stability deadline (ms)", type: "number", min: 1, max: 3600000 }],
  decide: [{ key: "decision_profile_ref", label: "Decision profile", type: "text", profileField: true }],
  analyze: [{ key: "operation_ref", label: "Analysis operation", type: "text" }],
  execute_action: [],
  route: [{ key: "selector_ref", label: "Selector reference", type: "text" }],
  loop: [{ key: "body_graph", label: "Body graph", type: "text" }, { key: "max_iterations", label: "Maximum iterations", type: "number", min: 1 }, { key: "exit_guard_ref", label: "Exit guard", type: "text" }],
  subworkflow: [],
  adaptive_region: [{ key: "region_id", label: "Protected region", type: "text" }, { key: "planner_profile_ref", label: "Planner profile", type: "text", profileField: true }, { key: "max_plan_nodes", label: "Maximum plan nodes", type: "number", min: 1, max: 32 }, { key: "max_plan_edges", label: "Maximum plan edges", type: "number", min: 0, max: 128 }, { key: "max_replans", label: "Maximum replans", type: "number", min: 0, max: 8 }],
  checkpoint: [{ key: "label", label: "Checkpoint label", type: "text" }],
  emit_artifact: [{ key: "artifact_kind_ref", label: "Artifact kind", type: "text" }],
  pause: [{ key: "reason_code", label: "Pause reason", type: "text" }],
  terminal: [],
};
function ReferenceSelectField({ node, fieldKey, label, options, disabled, onUpdate }: { node: WorkflowNode; fieldKey: string; label: string; options: string[]; disabled: boolean; onUpdate: TypedConfigFieldsProps["onUpdate"] }): JSX.Element {
  const current = typeof node.config[fieldKey] === "string" ? node.config[fieldKey] as string : "";
  const values = [...new Set([...(current ? [current] : []), ...options])];
  return <label className="field-label">{label}<span className="muted">owner-disclosed context reference</span>
    <select aria-label={`${node.id} ${label}`} value={current} disabled={disabled || options.length === 0} onChange={(event) => {
      if (!options.includes(event.target.value)) return;
      onUpdate((candidate) => ({ ...candidate, config: { ...candidate.config, [fieldKey]: event.target.value } }));
    }}>
      {!current ? <option value="">Select a disclosed reference</option> : null}
      {values.map((value) => <option key={value} value={value} disabled={!options.includes(value)}>{value}{options.includes(value) ? "" : " (current, not disclosed)"}</option>)}
    </select>
    {!options.length ? <span className="field-unknown">The owner did not disclose compatible context references; use JSON mode for a deliberate candidate.</span> : null}
  </label>;
}
/** Producer `InferenceProfileRef` exact-pin format: the ref is
 * `profile_id:major.minor.patch:<sha256>` and the producer splits it with
 * `rsplitn(3, ':')`, so the pin is written here in exactly that shape. The
 * resolver is exact-pin only, which is what keeps a floating id — which the
 * producer refuses when several available revisions match — from ever being
 * written by this surface. */
function inferenceProfilePin(profileId: string, version: string, digest: string): string {
  return formatInferenceProfilePin({ profile_id: profileId, version, digest });
}

/** Operator-facing wording for each refusal the owner can publish. The reason
 * code is kept verbatim next to the sentence so a designer can report exactly
 * what the owner said rather than a paraphrase that merges two different
 * problems. */
const inferenceProfileRejectionText: Record<InferenceProfileRejection, string> = {
  unknown_profile: "the owner has not published this profile",
  digest_mismatch: "the pinned digest does not match the published descriptor",
  revoked: "the owner revoked this profile",
  disabled: "the owner disabled this profile",
  stale: "this revision is stale",
  unsupported: "the owner does not support this profile here",
  unsupported_node_kind: "the owner does not serve this profile for this node kind",
  selection_not_granted: "the owner did not grant this browser permission to bind it",
  context_incompatible: "the owner does not admit this profile for this node's context",
  catalog_untrusted: "the owner catalog is not trusted; no profile can be selected",
};

function InferenceProfileSelectField({ node, fieldKey, label, catalog, contextRef, disabled, onUpdate }: {
  node: WorkflowNode; fieldKey: string; label: string;
  catalog: InferenceProfileCatalog | undefined; contextRef: string | undefined;
  disabled: boolean; onUpdate: TypedConfigFieldsProps["onUpdate"];
}): JSX.Element {
  // Capability-aware options: only descriptors the owner marks available AND
  // selectable for THIS node kind. A profile the browser may not bind is never
  // offered.
  const { selectable, uneditable } = inferenceProfilesForNodeKind(catalog, node.kind);
  const options = selectable
    .filter((descriptor) => contextRef === undefined || descriptor.context_compatibility.length === 0
      || descriptor.context_compatibility.includes(contextRef))
    .map((descriptor) => ({ value: inferenceProfilePin(descriptor.profile_id, descriptor.version, descriptor.digest), descriptor }));
  const currentRaw = node.config[fieldKey];
  const current = typeof currentRaw === "string" ? currentRaw : undefined;
  // A CURRENT binding is resolved through the owner's own resolver, so a
  // profile that has since been revoked, disabled, gone stale, had its digest
  // change, lost its selection grant, or become context-incompatible surfaces
  // as an explicit refusal. It is never silently dropped and never silently
  // replaced with a different profile.
  const selection = current === undefined ? undefined : parseInferenceProfilePin(current);
  const resolution = selection === undefined ? undefined
    : resolveInferenceProfile(catalog, selection, node.kind, contextRef);
  const refused = resolution !== undefined && !resolution.ok;
  const rejection = resolution !== undefined && !resolution.ok ? resolution.rejection : undefined;
  const values = [...new Set([...(current ? [current] : []), ...options.map((option) => option.value)])];
  const select = (next: string): void => {
    // Only a value the owner published for this node kind may be written, and
    // only as its exact pin. Anything else — including the currently-refused
    // value — is refused here rather than committed to the document.
    const chosen = options.find((option) => option.value === next);
    if (!chosen) return;
    onUpdate((candidate) => ({ ...candidate, config: { ...candidate.config, [fieldKey]: next } }));
  };
  return <div className="binding-field" aria-label={`${node.id} ${label} field`}>
    <p className="field-label">{label}<span className="muted">owner inference profile · exact pin</span></p>
    <select aria-label={`${node.id} ${label}`} value={current ?? ""} disabled={disabled || options.length === 0} onChange={(event) => select(event.target.value)}>
      {!current ? <option value="">Select an owner-published profile</option> : null}
      {values.map((value) => {
        const option = options.find((candidate) => candidate.value === value);
        return <option key={value} value={value} disabled={!option}>{value}{option ? "" : refused ? " (refused)" : " (current, not selectable)"}</option>;
      })}
    </select>
    {!catalog ? <span className="field-unknown">The owner profile catalog is unavailable, so no profile can be selected. Use JSON mode for a deliberate candidate.</span> : null}
    {catalog && options.length === 0 ? <span className="field-unknown">The owner published no selectable {label.toLowerCase()} for this node kind. Use JSON mode for a deliberate candidate.</span> : null}
    {refused && rejection ? <div className="reference-resolution" aria-label={`${label} refusal`} data-status="refused" data-rejection={rejection}>
      <StatusBadge tone="danger">refused</StatusBadge>
      <span>{rejection}: {inferenceProfileRejectionText[rejection]}</span>
    </div> : null}
    {resolution?.ok ? <div className="reference-resolution" aria-label={`${label} resolution`} data-status="resolved">
      <StatusBadge tone="success">resolved</StatusBadge>
      <dl>
        {/* Requested and resolved are reported separately and are never
            merged: `resolved_model` is null until the owner has actually
            observed an effective model, and must not be inferred. */}
        <dt>Adapter</dt><dd>{resolution.adapter}</dd>
        <dt>Requested model</dt><dd>{resolution.requested_model}</dd>
        <dt>Resolved model</dt><dd>{resolution.resolved_model ?? "not yet observed by the owner"}</dd>
        <dt>Prompt revision</dt><dd>{resolution.prompt_revision}</dd>
        <dt>Settings revision</dt><dd>{resolution.settings_revision}</dd>
        <dt>Continuity</dt><dd>provider session {resolution.continuity?.provider_session_continuity ? "continuous" : "not continuous"} · survives controller restart {resolution.continuity?.survives_controller_restart ? "yes" : "no"}</dd>
        <dt>Effective budget · input bytes</dt><dd>{resolution.effective_budgets?.max_input_bytes}</dd>
        <dt>Effective budget · output tokens</dt><dd>{resolution.effective_budgets?.max_output_tokens}</dd>
        <dt>Effective budget · provider calls</dt><dd>{resolution.effective_budgets?.max_provider_calls}</dd>
      </dl>
      <p className="muted">Owner-published operations for this profile are fixed and cannot be widened from this view: {(resolution.operations ?? []).join(", ") || "none"}.</p>
    </div> : null}
    {uneditable.length ? <p className="muted" role="note">{uneditable.length} profile{uneditable.length === 1 ? "" : "s"} the owner published for this node kind {uneditable.length === 1 ? "is" : "are"} not selectable ({uneditable.map((descriptor) => `${descriptor.profile_id}:${descriptor.state}${descriptor.grants.select ? "" : "/selection denied"}`).join(", ")}). A previously bound profile that becomes unselectable is reported as a refusal above.</p> : null}
  </div>;
}

function AllowedOperationsField({ node, options, disabled, onUpdate }: { node: WorkflowNode; options: string[]; disabled: boolean; onUpdate: TypedConfigFieldsProps["onUpdate"] }): JSX.Element {
  const raw = node.config.allowed_operations;
  const current = Array.isArray(raw) ? raw.filter((value): value is string => typeof value === "string") : [];
  const values = [...new Set([...current, ...options])];
  const toggle = (operation: string): void => {
    const next = current.includes(operation) ? current.filter((value) => value !== operation) : [...current, operation];
    if (next.length === 0 || next.length > 32) return;
    onUpdate((candidate) => ({ ...candidate, config: { ...candidate.config, allowed_operations: next } }));
  };
  return <fieldset className="allowed-operations-field" disabled={disabled}>
    <legend className="field-label">Allowed operations<span className="muted">owner-disclosed operation references · max 32</span></legend>
    {values.length ? <div className="checkbox-grid">{values.map((operation) => <label key={operation}><input type="checkbox" aria-label={`${node.id} allowed operation ${operation}`} checked={current.includes(operation)} onChange={() => toggle(operation)} /> <code>{operation}</code>{options.includes(operation) ? null : <span className="muted"> current</span>}</label>)}</div> : <p className="field-unknown">No operation references were disclosed by the owner. Existing values remain visible through JSON mode and validation remains authoritative.</p>}
    {current.length === 0 ? <p className="field-error" role="alert">At least one allowed operation is required by the owner.</p> : null}
  </fieldset>;
}
function ProposalBindingField({ document, graphId, node, requiredType, label, disabled, onUpdate }: { document: SemanticDocument; graphId: string; node: WorkflowNode; requiredType: "DecisionProposal" | "any"; label: string; disabled: boolean; onUpdate: TypedConfigFieldsProps["onUpdate"] }): JSX.Element {
  const key = node.kind === "emit_artifact" ? "input_from" : "proposal_from";
  const raw = node.config[key];
  const binding = raw !== null && typeof raw === "object" && !Array.isArray(raw) ? raw as JsonObject : {};
  const sourceId = typeof binding.node_id === "string" ? binding.node_id : "";
  const sourceOutput = typeof binding.output === "string" ? binding.output : "";
  const candidates = compatibleNodeOutputs(document, graphId, requiredType, node.id);
  const graph = document.graphs.find((candidate) => candidate.id === graphId);
  const sourceNode = graph?.nodes.find((candidate) => candidate.id === sourceId);
  const outputOptions = sourceNode ? nodeOutputs(sourceNode).filter((output) => candidates.some((candidate) => candidate.nodeId === output.nodeId && candidate.output === output.output)) : [];
  const sourceValues = [...new Set([...(sourceId ? [sourceId] : []), ...candidates.map((candidate) => candidate.nodeId)])];
  const outputValues = [...new Set([...(sourceOutput ? [sourceOutput] : []), ...outputOptions.map((candidate) => candidate.output)])];
  const update = (nextNodeId: string, nextOutput: string): void => {
    const candidate = candidates.find((value) => value.nodeId === nextNodeId && value.output === nextOutput);
    if (!candidate) return;
    onUpdate((current) => ({ ...current, config: { ...current.config, [key]: { node_id: candidate.nodeId, output: candidate.output } } }));
  };
  const invalid = !candidates.some((candidate) => candidate.nodeId === sourceId && candidate.output === sourceOutput);
  return <div className="binding-field" aria-label={`${node.id} ${label}`}>
    <p className="field-label">{label}<span className="muted">owner output binding</span></p>
    <label className="field-label">Source node<select aria-label={`${node.id} ${label} source node`} value={sourceId} disabled={disabled || sourceValues.length === 0} onChange={(event) => {
      const nextNode = candidates.find((candidate) => candidate.nodeId === event.target.value);
      update(event.target.value, nextNode?.output ?? "");
    }}>
      {!sourceId ? <option value="">Select a compatible source</option> : null}
      {sourceValues.map((value) => <option key={value} value={value}>{value}{candidates.some((candidate) => candidate.nodeId === value) ? "" : " (stale)"}</option>)}
    </select></label>
    <label className="field-label">Output<select aria-label={`${node.id} ${label} output`} value={sourceOutput} disabled={disabled || outputValues.length === 0} onChange={(event) => update(sourceId, event.target.value)}>
      {!sourceOutput ? <option value="">Select a compatible output</option> : null}
      {outputValues.map((value) => <option key={value} value={value}>{value}</option>)}
    </select></label>
    {invalid ? <p className="field-error" role="alert">This binding is missing or incompatible with an owner output. Select an admitted source and output before validation.</p> : null}
  </div>;
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
