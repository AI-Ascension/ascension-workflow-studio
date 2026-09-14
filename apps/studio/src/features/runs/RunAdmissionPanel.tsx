import type {
  RunTargetConfiguration,
  TargetAdmissionBinding,
  TargetCatalogResponse,
  TargetDescriptor,
  WorkflowDefinition,
} from "@studio/contracts";

import { StatusBadge } from "../../components/StatusBadge";

export type RunAdmissionPhase =
  | "loading"
  | "ready"
  | "preflighting"
  | "preflight_unknown"
  | "admitted"
  | "submitting"
  | "unknown"
  | "error";

export interface RunTargetSelection {
  targetId: string;
  executionProfile: string;
  gameProfile: string;
  saveProfile: string | null;
  inferenceProfile: string | null;
  contextCapability: string | null;
  providerCapability: string | null;
}

export interface PendingRun {
  document: WorkflowDefinition;
  digest?: string;
  requestId: string;
  catalog?: TargetCatalogResponse;
  selection?: RunTargetSelection;
  admission?: TargetAdmissionBinding;
  phase: RunAdmissionPhase;
  message?: string;
  liveConfirmed: boolean;
}

export type RunSelectionField = Exclude<keyof RunTargetSelection, "targetId">;

export function createRunRequestId(): string {
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `studio.run.${random}`;
}

export function selectionForTarget(descriptor: TargetDescriptor): RunTargetSelection {
  // Selecting a target never chooses a profile on the operator's behalf. Every
  // execution/game profile must be chosen explicitly before preflight.
  return {
    targetId: descriptor.instance_id,
    executionProfile: "",
    gameProfile: "",
    saveProfile: null,
    inferenceProfile: null,
    contextCapability: null,
    providerCapability: null,
  };
}

export function targetConfigurationForSelection(
  descriptor: TargetDescriptor,
  selection: RunTargetSelection,
  document: WorkflowDefinition,
): RunTargetConfiguration {
  return {
    instance_id: selection.targetId,
    execution_profile: selection.executionProfile,
    execution_mode: descriptor.execution_mode,
    workflow_revision: document.version,
    compatibility_revision: descriptor.compatibility_revision,
    capability_revision: descriptor.capability_revision,
    game_profile: selection.gameProfile,
    save_profile: selection.saveProfile,
    inference_profile: selection.inferenceProfile,
    context_capability: selection.contextCapability,
    provider_capability: selection.providerCapability,
  };
}

export interface RunAdmissionPanelProps {
  pending: PendingRun;
  onCancel: () => void;
  onRetryCatalog: () => void;
  onPreflight: () => void;
  onRetry: () => void;
  onSubmit: () => void;
  onTargetChange: (targetId: string) => void;
  onProfileChange: (field: RunSelectionField, value: string | null) => void;
  onLiveConfirmation: (confirmed: boolean) => void;
}

function phaseLabel(phase: RunAdmissionPhase): string {
  switch (phase) {
    case "loading": return "Loading target catalog";
    case "ready": return "Awaiting preflight";
    case "preflighting": return "Checking admission";
    case "preflight_unknown": return "Preflight outcome unknown";
    case "admitted": return "Admission reviewed";
    case "submitting": return "Submitting run";
    case "unknown": return "Run outcome unknown";
    case "error": return "Admission rejected";
  }
}

function selectValue(value: string | null): string {
  return value ?? "";
}

function OptionList({ values, includeNone }: { values: string[]; includeNone?: boolean }): JSX.Element {
  return <>
    {includeNone ? <option value="">none</option> : null}
    {values.map((value) => <option key={value} value={value}>{value}</option>)}
  </>;
}

function SummaryRow({ label, value }: { label: string; value: string | null }): JSX.Element {
  return <div className="admission-row"><dt>{label}</dt><dd>{value ?? "none"}</dd></div>;
}

function AdmissionSummary({ admission, digest, requestId }: { admission: TargetAdmissionBinding; digest?: string; requestId: string }): JSX.Element {
  return <dl className="admission-summary" aria-label="Exact admission binding">
    <SummaryRow label="Request ID" value={requestId} />
    <SummaryRow label="Target instance" value={admission.target.instance_id} />
    <SummaryRow label="Execution mode" value={admission.target.execution_mode} />
    <SummaryRow label="Execution profile" value={admission.target.execution_profile} />
    <SummaryRow label="Game profile" value={admission.target.game_profile} />
    <SummaryRow label="Save profile" value={admission.target.save_profile} />
    <SummaryRow label="Provider profile" value={admission.target.inference_profile} />
    <SummaryRow label="Context capability" value={admission.target.context_capability} />
    <SummaryRow label="Provider capability" value={admission.target.provider_capability} />
    <SummaryRow label="Workflow revision" value={admission.target.workflow_revision} />
    <SummaryRow label="Compatibility revision" value={admission.target.compatibility_revision} />
    <SummaryRow label="Capability revision" value={admission.target.capability_revision} />
    <SummaryRow label="Definition digest" value={admission.workflow_definition_digest || digest || null} />
    <SummaryRow label="Descriptor digest" value={admission.descriptor_digest} />
    <SummaryRow label="Catalog revision" value={admission.catalog_revision} />
  </dl>;
}

export function RunAdmissionPanel(props: RunAdmissionPanelProps): JSX.Element {
  const { pending, onCancel, onRetryCatalog, onPreflight, onRetry, onSubmit, onTargetChange, onProfileChange, onLiveConfirmation } = props;
  const catalog = pending.catalog;
  const selection = pending.selection;
  const descriptor = selection ? catalog?.targets.find((target) => target.instance_id === selection.targetId) : undefined;
  const admitted = pending.phase === "admitted" && pending.admission ? pending.admission : undefined;
  const isLive = admitted?.target.execution_mode === "live";
  const busy = pending.phase === "loading" || pending.phase === "preflighting" || pending.phase === "submitting";
  const canChangeSelection = pending.phase !== "submitting" && pending.phase !== "unknown";

  return <section className="panel-card run-admission" aria-label="Run admission" aria-live="polite">
    <div className="panel-title">
      <div>
        <p className="eyebrow">Explicit target admission</p>
        <h2>Review before the owner starts a run</h2>
      </div>
      <StatusBadge tone={pending.phase === "error" ? "danger" : admitted ? "success" : "warning"}>{phaseLabel(pending.phase)}</StatusBadge>
    </div>
    <p className="admission-revision">Workflow {pending.document.workflow_id}@{pending.document.version} · {pending.digest ? `digest ${pending.digest.slice(0, 12)}…` : "digest pending"}</p>
    {pending.message ? <p className="admission-message" role="status">{pending.message}</p> : null}

    {pending.phase === "loading" ? <div className="control-grid">
      <button className="button button-quiet" onClick={onCancel}>Cancel run setup</button>
    </div> : null}

    {pending.phase === "error" && !selection ? <div className="control-grid">
      <button className="button button-secondary" onClick={onRetryCatalog}>Refresh targets</button>
      <button className="button button-quiet" onClick={onCancel}>Cancel run setup</button>
    </div> : null}

    {catalog && canChangeSelection ? <div className="admission-form" aria-label="Run target configuration">
      <label className="field-label">Target instance
        <select aria-label="Target instance" value={selection?.targetId ?? ""} disabled={busy} onChange={(event) => onTargetChange(event.target.value)}>
          <option value="">Select a target…</option>
          {catalog.targets.map((target) => <option key={target.instance_id} value={target.instance_id} disabled={target.availability !== "available"}>
            {target.instance_id} · {target.execution_mode} · {target.availability}
          </option>)}
        </select>
      </label>
      <label className="field-label">Execution profile
        <select aria-label="Execution profile" value={selectValue(selection?.executionProfile ?? null)} disabled={busy || !descriptor} onChange={(event) => onProfileChange("executionProfile", event.target.value)}>
          <option value="">Select a profile…</option>
          {descriptor ? <OptionList values={descriptor.execution_profiles} /> : null}
        </select>
      </label>
      <label className="field-label">Game profile
        <select aria-label="Game profile" value={selectValue(selection?.gameProfile ?? null)} disabled={busy || !descriptor} onChange={(event) => onProfileChange("gameProfile", event.target.value)}>
          <option value="">Select a game profile…</option>
          {descriptor ? <OptionList values={descriptor.game_profiles} /> : null}
        </select>
      </label>
      <label className="field-label">Save profile
        <select aria-label="Save profile" value={selectValue(selection?.saveProfile ?? null)} disabled={busy || !descriptor} onChange={(event) => onProfileChange("saveProfile", event.target.value || null)}>
          {descriptor ? <OptionList values={descriptor.save_profiles} includeNone /> : <option value="">none</option>}
        </select>
      </label>
      <label className="field-label">Provider profile
        <select aria-label="Provider profile" value={selectValue(selection?.inferenceProfile ?? null)} disabled={busy || !descriptor} onChange={(event) => onProfileChange("inferenceProfile", event.target.value || null)}>
          {descriptor ? <OptionList values={descriptor.inference_profiles} includeNone /> : <option value="">none</option>}
        </select>
      </label>
      <label className="field-label">Context capability
        <select aria-label="Context capability" value={selectValue(selection?.contextCapability ?? null)} disabled={busy || !descriptor} onChange={(event) => onProfileChange("contextCapability", event.target.value || null)}>
          {descriptor ? <OptionList values={descriptor.capabilities.filter((capability) => capability.includes("context"))} includeNone /> : <option value="">none</option>}
        </select>
      </label>
      <label className="field-label">Provider capability
        <select aria-label="Provider capability" value={selectValue(selection?.providerCapability ?? null)} disabled={busy || !descriptor} onChange={(event) => onProfileChange("providerCapability", event.target.value || null)}>
          {descriptor ? <OptionList values={descriptor.capabilities.filter((capability) => capability.includes("provider"))} includeNone /> : <option value="">none</option>}
        </select>
      </label>
    </div> : null}

    {pending.phase === "ready" ? <div className="control-grid">
      <button className="button button-primary" onClick={onPreflight} disabled={!selection || !selection.executionProfile || !selection.gameProfile}>Run preflight</button>
      <button className="button button-secondary" onClick={onRetryCatalog}>Refresh targets</button>
      <button className="button button-quiet" onClick={onCancel}>Cancel run setup</button>
    </div> : null}

    {pending.phase === "preflighting" ? <p className="muted">The owner is validating the exact target, profiles and definition digest…</p> : null}

    {pending.phase === "preflight_unknown" ? <div className="control-grid">
      <button className="button button-secondary" onClick={onRetry}>Retry preflight</button>
      <button className="button button-quiet" onClick={onCancel}>Cancel run setup</button>
    </div> : null}

    {admitted ? <>
      <AdmissionSummary admission={admitted} digest={pending.digest} requestId={pending.requestId} />
      {isLive ? <label className="checkbox-label">
        <input type="checkbox" aria-label="Confirm live execution" checked={pending.liveConfirmed} onChange={(event) => onLiveConfirmation(event.target.checked)} />
        I explicitly authorize this live execution on the selected target.
      </label> : null}
      <div className="control-grid">
        <button className="button button-primary" onClick={onSubmit} disabled={isLive && !pending.liveConfirmed}>Start run</button>
        <button className="button button-secondary" onClick={onRetryCatalog} disabled={!canChangeSelection}>Change selection</button>
        <button className="button button-quiet" onClick={onCancel}>Cancel run setup</button>
      </div>
    </> : null}

    {pending.phase === "submitting" ? <p className="muted">Submitting the exact reviewed admission to the owner…</p> : null}

    {pending.phase === "unknown" ? <div className="control-grid">
      <button className="button button-secondary" onClick={onRetry}>Retry the same request</button>
      <button className="button button-quiet" onClick={onCancel}>Cancel run setup</button>
    </div> : null}
  </section>;
}
