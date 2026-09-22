import { useEffect, useMemo, useRef, useState } from "react";

import { type JsonObject, type JsonValue } from "@studio/contracts";
import {
  GUARD_OPERATORS,
  cloneDocument,
  encodeGuardValue,
  evaluateGuard,
  guardOperatorSpec,
  guardReferencedFields,
  isRegisteredGuardOperator,
  type SemanticDocument,
} from "@studio/document";

export function DefinitionControls({ document, onCommit }: { document: SemanticDocument; onCommit: (next: SemanticDocument) => void }): JSX.Element {
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
