import type {
  CapabilityResponse,
  CommandKind,
  CommandResponse,
  ContextAssociation,
  ContextControlCommand,
  ContextControlReceipt,
  ContextOwnerAssociation,
  ContextOwnerCatalog,
  ContextOwnerEffectiveLimits,
  DefinitionRecord,
  DraftRecord,
  EventPage,
  ExportResponse,
  InspectResponse,
  JsonObject,
  ProviderSessionList,
  ProviderSessionPolicyCommandResponse,
  ProviderSessionPolicyViewResponse,
  ReplayResponse,
  RunEvent,
  RunSubmissionResponse,
  RunTargetConfiguration,
  StatusResponse,
  TargetAdmissionBinding,
  TargetAdmissionRequest,
  TargetCatalogResponse,
  TargetPreflightResponse,
  ValidateResponse,
  WorkflowDefinition,
} from "@studio/contracts";

export type ClientMode = "fixture" | "live";

export interface DraftWrite {
  draftId: string;
  definitionId: string;
  revision: number;
  etag: string;
  document: WorkflowDefinition;
  layout: JsonObject;
  clientMutationId?: string;
}

export interface PublishResult {
  outcome: "published" | "already_published" | "conflict";
  definition?: DefinitionRecord;
  draft?: DraftRecord;
}

export interface RunSubmissionOptions {
  /** Stable identity reused for preflight, submit, and explicit retry. */
  requestId?: string;
  /** Exact owner-issued binding returned by target preflight. */
  admission?: TargetAdmissionBinding;
  /** Exact configuration reviewed by the operator before preflight. */
  target?: RunTargetConfiguration;
}

export interface StudioClient {
  readonly mode: ClientMode;
  /** Principal bound to this session; recovery data is keyed by it. */
  principal(): string;
  listDefinitions(): Promise<DefinitionRecord[]>;
  getDraft(draftId: string): Promise<DraftRecord | undefined>;
  saveDraft(write: DraftWrite): Promise<DraftRecord>;
  publishDraft(draftId: string, expectedRevision: number, etag: string, definitionDigest: string, clientMutationId?: string): Promise<PublishResult>;
  health(): Promise<{ status: string }>;
  capabilities(): Promise<CapabilityResponse>;
  listContextBindings(): Promise<ContextOwnerCatalog>;
  contextOwnerAssociation(runId: string): Promise<ContextOwnerAssociation>;
  contextOwnerEffectiveLimits(runId: string): Promise<ContextOwnerEffectiveLimits>;
  lookupContextControlReceipt(runId: string, command: ContextControlCommand): Promise<ContextControlReceipt>;
  validate(definition: WorkflowDefinition): Promise<ValidateResponse>;
  inspect(definition: WorkflowDefinition): Promise<InspectResponse>;
  diff(oldDefinition: WorkflowDefinition, newDefinition: WorkflowDefinition): Promise<{
    old_definition_digest: string;
    new_definition_digest: string;
    semantic_change: boolean;
    changed_paths: string[];
  }>;
  listTargets(): Promise<TargetCatalogResponse>;
  preflightTarget(request: TargetAdmissionRequest): Promise<TargetPreflightResponse>;
  submitRun(definition: WorkflowDefinition, instanceId: string, profile: string, options?: RunSubmissionOptions): Promise<RunSubmissionResponse>;
  status(runId: string): Promise<StatusResponse>;
  events(runId: string, afterSequence: number, limit?: number): Promise<EventPage>;
  contextAssociation(runId: string): Promise<ContextAssociation>;
  /** Harness-owned, read-only session metadata for this exact workflow run. */
  providerSessions(runId: string): Promise<ProviderSessionList>;
  command(runId: string, expectedRevision: number, kind: CommandKind, commandId?: string): Promise<CommandResponse>;
  replay(runId: string): Promise<ReplayResponse>;
  export(runId: string): Promise<ExportResponse>;
}

export interface OwnerApiClientOptions {
  baseUrl?: string;
  token?: string;
  actorScope?: string;
  fetcher?: typeof fetch;
}

export interface ProviderSessionPolicyClient {
  providerSessionPolicy(runId: string): Promise<ProviderSessionPolicyViewResponse>;
  importProviderSessionPolicy(runId: string, expectedRevision: number, bytes: ArrayBuffer): Promise<ProviderSessionPolicyCommandResponse>;
  proposeProviderSessionPolicy(runId: string, proposalId: string, sourceSha256: string, expectedRevision: number, bytes: ArrayBuffer): Promise<ProviderSessionPolicyCommandResponse>;
  approveProviderSessionPolicy(runId: string, proposalId: string, proposalSha256: string, approvalRef: string, expectedRevision: number): Promise<ProviderSessionPolicyCommandResponse>;
  adoptProviderSessionPolicyProposal(runId: string, proposalId: string, proposalSha256: string, approvalRef: string, expectedRevision: number): Promise<ProviderSessionPolicyCommandResponse>;
  adoptImportedProviderSessionPolicy(runId: string, policySha256: string, expectedRevision: number): Promise<ProviderSessionPolicyCommandResponse>;
}

export interface RunProjection {
  runId: string;
  definitionDigest: string;
  schemaVersion: string;
  lastSequence: number;
  events: RunEvent[];
}

export type ProjectionResult =
  | { kind: "applied"; projection: RunProjection; added: number }
  | { kind: "duplicate"; projection: RunProjection }
  | { kind: "resnapshot"; reason: string; projection: RunProjection };
