import { z } from "zod";

import {
  CapabilityResponseSchema,
  ContextOwnerCatalogSchema,
  ContextOwnerAssociationSchema,
  ContextOwnerEffectiveLimitsSchema,
  ContextControlCommandSchema,
  ContextControlReceiptSchema,
  ContextAssociationSchema,
  ContextComparisonSchema,
  ContextEventPageSchema,
  ContextSnapshotListSchema,
  ContextSnapshotManifestSchema,
  MemoryCapabilitiesSchema,
  ProviderSessionCapabilitiesSchema,
  ProviderSessionPolicyCommandResponseSchema,
  ProviderSessionPolicyViewResponseSchema,
  type ProviderSessionCapabilities,
  type ProviderSessionPolicyCommandResponse,
  type ProviderSessionPolicyViewResponse,
  ProviderSessionListSchema,
  CommandResponseSchema,
  DefinitionRecordSchema,
  DiffResponseSchema,
  DraftRecordSchema,
  ErrorResponseSchema,
  EventPageSchema,
  ExportResponseSchema,
  HealthResponseSchema,
  InspectResponseSchema,
  ReplayResponseSchema,
  RunEventSchema,
  RunSnapshotSchema,
  RunSubmissionResponseSchema,
  StatusResponseSchema,
  StudioOwnerDefinitionsResponseSchema,
  StudioOwnerDraftSchema,
  StudioOwnerPublishResponseSchema,
  TargetAdmissionBindingSchema,
  TargetAdmissionRequestSchema,
  TargetCatalogResponseSchema,
  TargetPreflightResponseSchema,
  RunTargetConfigurationSchema,
  ValidateResponseSchema,
  WorkflowDefinitionSchema,
  decodeWith,
  type CapabilityResponse,
  type ContextOwnerCatalog,
  type ContextOwnerAssociation,
  type ContextOwnerEffectiveLimits,
  type ContextControlCommand,
  type ContextControlReceipt,
  type ContextAssociation,
  type ContextComparison,
  type ContextEventPage,
  type ContextSnapshotList,
  type ContextSnapshotManifest,
  type MemoryCapabilities,
  type ProviderSessionList,
  type CommandKind,
  type CommandResponse,
  type DefinitionRecord,
  type DraftRecord,
  type EventPage,
  type ExportResponse,
  type InspectResponse,
  type JsonValue,
  type ReplayResponse,
  type RunEvent,
  type RunSnapshot,
  type RunSubmissionResponse,
  type StatusResponse,
  type TargetAdmissionBinding,
  type TargetAdmissionRequest,
  type TargetCatalogResponse,
  type TargetDescriptor,
  type TargetPreflightResponse,
  type RunTargetConfiguration,
  type JsonObject,
  type ValidateResponse,
  type WorkflowDefinition,
} from "@studio/contracts";
import { canonicalJson, cloneDocument, definitionIdentityDigest, diffDocuments, semanticDigest, sha256Hex, validateNodeBindings } from "@studio/document";
import contextCatalogFixture from "../../../contracts/accepted/context-control/catalog-conformance.json" with { type: "json" };
import { readContextCatalogBody } from "./context-owner-catalog";

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

const FIXTURE_TARGET_CAPABILITIES = [
  "studio.fixture.v1",
  "observe.fair-play.v1",
  "observe.map.v1",
  "actions.catalog.v1",
  "actions.settlement.v1",
  "authority.generation-fence.v1",
  "actions.setup.v1",
  "actions.selection.v1",
  "actions.combat.v1",
  "actions.campaign.v1",
  "actions.map.v1",
  "actions.reward.v1",
  "actions.shop.v1",
  "actions.event.v1",
  "actions.rest.v1",
  "operations.reconcile.v1",
  "terminal.observation.v1",
  "analysis.combat.v1",
] as const;

export function fixtureTargetCatalog(): TargetCatalogResponse {
  return TargetCatalogResponseSchema.parse({
    schema_version: "ascension.workflow-targets/v1",
    catalog_revision: "fixture-target-catalog.v1",
    targets: [{
      instance_id: "studio-inspection",
      execution_profiles: ["synthetic"],
      execution_mode: "synthetic",
      compatibility_revision: "fixture.compatibility.v1",
      capability_revision: "fixture.capabilities.v1",
      availability: "available",
      supported_operations: ["workflow:run", "workflow:live"],
      capabilities: [...FIXTURE_TARGET_CAPABILITIES],
      game_profiles: ["sts2-synthetic-v1"],
      save_profiles: ["save.synthetic.default"],
      inference_profiles: ["inference.synthetic.default"],
    }, {
      instance_id: "studio-inspection-secondary",
      execution_profiles: ["synthetic.secondary"],
      execution_mode: "synthetic",
      compatibility_revision: "fixture.compatibility.v2",
      capability_revision: "fixture.capabilities.v2",
      availability: "available",
      supported_operations: ["workflow:run"],
      capabilities: [...FIXTURE_TARGET_CAPABILITIES],
      game_profiles: ["sts2-synthetic-v1"],
      save_profiles: [],
      inference_profiles: [],
    }],
  });
}

export async function fixtureContextOwnerCatalog(): Promise<ContextOwnerCatalog> {
  return ContextOwnerCatalogSchema.parse(contextCatalogFixture.catalogs.find((row) => row.name === "default")?.catalog);
}

const TARGET_CONFIGURATION_FIELDS: (keyof RunTargetConfiguration)[] = [
  "instance_id",
  "execution_profile",
  "execution_mode",
  "workflow_revision",
  "compatibility_revision",
  "capability_revision",
  "game_profile",
  "save_profile",
  "inference_profile",
  "context_capability",
  "provider_capability",
];

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function bindingMismatch(path: string, detail: string): never {
  throw new ClientError(`Target admission binding ${path} ${detail}`, "target_binding_mismatch", 409);
}

function assertEqualBindingField(path: string, actual: unknown, expected: unknown): void {
  if (actual !== expected) {
    bindingMismatch(path, `does not match the reviewed value (${String(expected)}).`);
  }
}

/**
 * Check that an owner-issued admission is the exact response to the request
 * that the Studio reviewed. Every target/profile field is compared, including
 * nullable optional profile and capability fields.
 */
export function validateTargetAdmissionBinding(
  admission: TargetAdmissionBinding,
  request: TargetAdmissionRequest,
): void {
  assertEqualBindingField("schema_version", admission.schema_version, request.schema_version);
  assertEqualBindingField("request_id", admission.request_id, request.request_id);
  assertEqualBindingField("workflow_definition_digest", admission.workflow_definition_digest, request.workflow_definition_digest);
  for (const field of TARGET_CONFIGURATION_FIELDS) {
    assertEqualBindingField(`target.${field}`, admission.target[field], request.target[field]);
  }
}

/**
 * Validate a selected target descriptor against every exact target/profile
 * binding. This is a local preflight guard only; the owner remains the
 * authority and must perform the same checks.
 */
export function validateTargetConfiguration(
  descriptor: TargetDescriptor,
  target: RunTargetConfiguration,
): void {
  if (descriptor.availability !== "available") {
    throw new CapabilityGateError(`Target ${descriptor.instance_id} is ${descriptor.availability}.`, "target_unavailable");
  }
  assertEqualBindingField("target.instance_id", target.instance_id, descriptor.instance_id);
  if (!descriptor.execution_profiles.includes(target.execution_profile)) {
    bindingMismatch("target.execution_profile", `is not supported by ${descriptor.instance_id}.`);
  }
  assertEqualBindingField("target.execution_mode", target.execution_mode, descriptor.execution_mode);
  if (target.execution_mode === "live" && !descriptor.supported_operations.includes("workflow:live")) {
    throw new CapabilityGateError(
      `Target ${descriptor.instance_id} does not advertise workflow:live.`,
      "target_operation_unavailable",
    );
  }
  assertEqualBindingField("target.compatibility_revision", target.compatibility_revision, descriptor.compatibility_revision);
  assertEqualBindingField("target.capability_revision", target.capability_revision, descriptor.capability_revision);
  if (!descriptor.game_profiles.includes(target.game_profile)) {
    bindingMismatch("target.game_profile", `is not supported by ${descriptor.instance_id}.`);
  }
  if (target.save_profile !== null && !descriptor.save_profiles.includes(target.save_profile)) {
    bindingMismatch("target.save_profile", `is not supported by ${descriptor.instance_id}.`);
  }
  if (target.inference_profile !== null && !descriptor.inference_profiles.includes(target.inference_profile)) {
    bindingMismatch("target.inference_profile", `is not supported by ${descriptor.instance_id}.`);
  }
  if (target.context_capability !== null && !descriptor.capabilities.includes(target.context_capability)) {
    bindingMismatch("target.context_capability", `is not advertised by ${descriptor.instance_id}.`);
  }
  if (target.provider_capability !== null && !descriptor.capabilities.includes(target.provider_capability)) {
    bindingMismatch("target.provider_capability", `is not advertised by ${descriptor.instance_id}.`);
  }
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

export class ClientError extends Error {
  public constructor(
    message: string,
    public readonly code: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "ClientError";
  }
}

export class CapabilityGateError extends ClientError {
  public constructor(message: string, code = "capability_unavailable") {
    super(message, code, 501);
    this.name = "CapabilityGateError";
  }
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

const MAX_POLICY_UPLOAD_BYTES = 1_048_576;

/** Separate same-origin client for Context Console projections. It intentionally
 * exposes only typed read methods and is not a generic route proxy. */
export class ContextServiceClient {
  private readonly baseUrl: string;
  private readonly fetcher: typeof fetch;
  private token: string | undefined;

  public constructor(options: { baseUrl?: string; token?: string; fetcher?: typeof fetch } = {}) {
    this.baseUrl = normalizeRelativeBase(options.baseUrl ?? "/api/context");
    this.fetcher = options.fetcher ?? fetch.bind(globalThis);
    this.token = options.token;
  }

  public setToken(token: string | undefined): void { this.token = token; }

  public async memoryCapabilities(): Promise<MemoryCapabilities> {
    return decodeWith(MemoryCapabilitiesSchema, await this.json("/v3/memory/capabilities"), "memory capabilities");
  }

  public async providerSessionCapabilities(contextRunId: string): Promise<ProviderSessionCapabilities> {
    const response = await this.json(`/v1/runs/${encodeIdentifier(contextRunId)}/provider-sessions/capabilities`);
    // Console capability projections use the same operation/value envelope as
    // session reads. This route uses the explicit Context run association.
    const envelope = z.object({
      schema: z.literal("ascension.provider-session.api-result.v1"),
      operation: z.literal("capabilities"),
      value: ProviderSessionCapabilitiesSchema,
      effect_class: z.literal("local_metadata_only"),
      inference_calls: z.literal(0),
      game_effects: z.literal(0),
    }).strict();
    return decodeWith(envelope, response, "provider-session capabilities").value;
  }

  public async snapshots(runId: string): Promise<ContextSnapshotList> {
    return decodeWith(ContextSnapshotListSchema, await this.json(`/v1/runs/${encodeIdentifier(runId)}/snapshots`), "context snapshot list");
  }

  public async compareSnapshots(runId: string, leftSnapshotId: string, rightSnapshotId: string): Promise<ContextComparison> {
    const query = new URLSearchParams({ left: encodeIdentifier(leftSnapshotId), right: encodeIdentifier(rightSnapshotId) });
    return decodeWith(ContextComparisonSchema, await this.json(`/v1/runs/${encodeIdentifier(runId)}/compare?${query}`), "context comparison");
  }

  public async snapshot(runId: string, snapshotId: string): Promise<ContextSnapshotManifest> {
    return decodeWith(ContextSnapshotManifestSchema, await this.json(`/v1/runs/${encodeIdentifier(runId)}/snapshots/${encodeIdentifier(snapshotId)}`), "context snapshot manifest");
  }

  public async events(runId: string, cursor?: string): Promise<ContextEventPage> {
    const query = cursor ? `?${new URLSearchParams({ cursor }).toString()}` : "";
    return decodeWith(ContextEventPageSchema, await this.json(`/v1/runs/${encodeIdentifier(runId)}/events${query}`), "context event page");
  }

  private async json(path: string): Promise<unknown> {
    try { return await (await this.request(path)).json(); }
    catch { throw new ClientError("Context service returned invalid JSON", "context_service_decode"); }
  }

  private async request(path: string): Promise<Response> {
    const headers = new Headers({ Accept: "application/json" });
    if (this.token) headers.set("Authorization", `Bearer ${this.token}`);
    let response: Response;
    try {
      response = await this.fetcher(`${this.baseUrl}${path}`, { method: "GET", headers, credentials: "same-origin" });
    } catch {
      throw new ClientError("Context service is unavailable", "context_service_unavailable");
    }
    if (!response.ok) throw new ClientError("Context service request was rejected", "context_service_rejected", response.status);
    return response;
  }
}

export class OwnerApiClient implements StudioClient, ProviderSessionPolicyClient {
  public readonly mode = "live" as const;
  private readonly baseUrl: string;
  private readonly fetcher: typeof fetch;
  private token: string | undefined;
  private actorScope: string | undefined;
  /** Requests are retained so a lost response can be retried verbatim. */
  private readonly targetAdmissionRequests = new Map<string, TargetAdmissionRequest>();

  public constructor(options: OwnerApiClientOptions = {}) {
    this.baseUrl = normalizeRelativeBase(options.baseUrl ?? "/v1");
    this.fetcher = options.fetcher ?? fetch.bind(globalThis);
    this.token = options.token;
    this.actorScope = options.actorScope?.trim() || undefined;
  }

  public setToken(token: string | undefined): void {
    this.token = token?.trim() || undefined;
  }

  public setActorScope(actorScope: string | undefined): void {
    this.actorScope = actorScope?.trim() || undefined;
  }

  public principal(): string {
    return this.actorScope ?? "unauthenticated";
  }

  public async listDefinitions(): Promise<DefinitionRecord[]> {
    const response = await this.request("/studio/definitions", { method: "GET" });
    const decoded = decodeWith(StudioOwnerDefinitionsResponseSchema, response, "Studio definition list");
    return decoded.definitions.map(ownerDefinitionToRecord);
  }

  public async getDraft(draftId: string): Promise<DraftRecord | undefined> {
    try {
      const response = await this.request(`/studio/drafts/${encodeIdentifier(draftId)}`, { method: "GET" });
      return ownerDraftToRecord(decodeWith(StudioOwnerDraftSchema, response, "Studio draft"));
    } catch (error: unknown) {
      if (error instanceof ClientError && error.status === 404) {
        return undefined;
      }
      throw error;
    }
  }

  public async saveDraft(write: DraftWrite): Promise<DraftRecord> {
    const mutationId = write.clientMutationId ?? `studio.mutation.${cryptoRandomId()}`;
    const body = {
      schema_version: "ascension.studio-authoring/v1",
      client_mutation_id: mutationId,
      document: write.document,
      layout: write.layout,
    };
    const creating = write.revision === 0 && write.etag === "fixture-0";
    const response = creating
      ? await this.request("/studio/drafts", {
        method: "POST",
        body: JSON.stringify({
          ...body,
          draft_id: write.draftId,
          definition_id: write.definitionId,
        }),
      })
      : await this.request(`/studio/drafts/${encodeIdentifier(write.draftId)}`, {
        method: "PUT",
        body: JSON.stringify({
          ...body,
          expected_revision: write.revision,
          etag: write.etag,
        }),
      });
    return ownerDraftToRecord(decodeWith(StudioOwnerDraftSchema, response, "Studio draft save"));
  }

  public async publishDraft(draftId: string, expectedRevision: number, etag: string, definitionDigest: string, clientMutationId = `studio.publish.${cryptoRandomId()}`): Promise<PublishResult> {
    const response = await this.request(`/studio/drafts/${encodeIdentifier(draftId)}/publish`, {
      method: "POST",
      body: JSON.stringify({
        schema_version: "ascension.studio-authoring/v1",
        expected_revision: expectedRevision,
        etag,
        client_mutation_id: clientMutationId,
        expected_definition_digest: definitionDigest,
      }),
    });
    const decoded = decodeWith(StudioOwnerPublishResponseSchema, response, "Studio publication");
    return {
      outcome: decoded.outcome,
      definition: decoded.definition ? ownerDefinitionToRecord(decoded.definition) : undefined,
      draft: decoded.draft ? ownerDraftToRecord(decoded.draft) : undefined,
    };
  }

  public async health(): Promise<{ status: string }> {
    const response = await this.request("/health", { method: "GET" });
    return decodeWith(HealthResponseSchema, response, "health");
  }

  public async capabilities(): Promise<CapabilityResponse> {
    const response = await this.request("/capabilities", { method: "GET" });
    return decodeWith(CapabilityResponseSchema, response, "capabilities");
  }

  public async listContextBindings(): Promise<ContextOwnerCatalog> {
    const response = await this.request("/context-bindings", { method: "GET" }, true);
    return decodeWith(ContextOwnerCatalogSchema, response, "context binding catalog");
  }

  public async contextOwnerAssociation(runId: string): Promise<ContextOwnerAssociation> {
    const response = await this.request(`/workflow-runs/${encodeIdentifier(runId)}/context-owner-association`, { method: "GET" });
    return decodeWith(ContextOwnerAssociationSchema, response, "current context owner association");
  }

  public async contextOwnerEffectiveLimits(runId: string): Promise<ContextOwnerEffectiveLimits> {
    const response = await this.request(`/workflow-runs/${encodeIdentifier(runId)}/context-owner-effective-limits`, { method: "GET" });
    return decodeWith(ContextOwnerEffectiveLimitsSchema, response, "current context owner effective limits");
  }

  public async lookupContextControlReceipt(runId: string, command: ContextControlCommand): Promise<ContextControlReceipt> {
    const checked = ContextControlCommandSchema.parse(command);
    const response = await this.request(`/workflow-runs/${encodeIdentifier(runId)}/context-control-receipts/lookup`, {
      method: "POST",
      body: JSON.stringify(checked),
    });
    return decodeWith(ContextControlReceiptSchema, response, "historical context control receipt");
  }

  public async validate(definition: WorkflowDefinition): Promise<ValidateResponse> {
    const capabilityResponse = await this.capabilities();
    const response = await this.request("/workflow-definitions/validate", {
      method: "POST",
      body: JSON.stringify({
        schema_version: "ascension.management/v1",
        definition,
        capabilities: capabilityResponse.capabilities,
      }),
    });
    const owner = decodeWith(ValidateResponseSchema, response, "definition validation");
    const bindingDiagnostics = validateNodeBindings(definition).map((diagnostic) => ({
      code: diagnostic.code,
      severity: "error" as const,
      path: diagnostic.path,
      message: diagnostic.message,
    }));
    return {
      ...owner,
      valid: owner.valid && bindingDiagnostics.length === 0,
      diagnostics: [...owner.diagnostics, ...bindingDiagnostics],
    };
  }

  public async inspect(definition: WorkflowDefinition): Promise<InspectResponse> {
    const response = await this.request("/workflow-definitions/inspect", {
      method: "POST",
      body: JSON.stringify({ schema_version: "ascension.management/v1", definition, format: "json" }),
    });
    return decodeWith(InspectResponseSchema, response, "definition inspection");
  }

  public async diff(oldDefinition: WorkflowDefinition, newDefinition: WorkflowDefinition): Promise<{
    old_definition_digest: string;
    new_definition_digest: string;
    semantic_change: boolean;
    changed_paths: string[];
  }> {
    const response = await this.request("/workflow-definitions/diff", {
      method: "POST",
      body: JSON.stringify({
        schema_version: "ascension.management/v1",
        old_definition: oldDefinition,
        new_definition: newDefinition,
        format: "json",
      }),
    });
    return decodeWith(DiffResponseSchema, response, "definition diff");
  }

  public async listTargets(): Promise<TargetCatalogResponse> {
    const response = await this.request("/workflow-targets", { method: "GET" });
    return decodeWith(TargetCatalogResponseSchema, response, "workflow target catalog");
  }

  public async preflightTarget(request: TargetAdmissionRequest): Promise<TargetPreflightResponse> {
    const body = TargetAdmissionRequestSchema.parse(request);
    const response = await this.request("/workflow-targets/preflight", {
      method: "POST",
      body: JSON.stringify(body),
    });
    const result = decodeWith(TargetPreflightResponseSchema, response, "workflow target preflight");
    validateTargetAdmissionBinding(result.admission, body);
    this.targetAdmissionRequests.set(body.request_id, cloneJson(body));
    return result;
  }

  public async submitRun(
    definition: WorkflowDefinition,
    instanceId: string,
    profile: string,
    options: RunSubmissionOptions = {},
  ): Promise<RunSubmissionResponse> {
    const admission = options.admission ? TargetAdmissionBindingSchema.parse(options.admission) : undefined;
    const requestId = options.requestId ?? admission?.request_id ?? `studio.${cryptoRandomId()}`;
    const parsedDefinition = WorkflowDefinitionSchema.parse(definition);
    if (!admission) {
      throw new CapabilityGateError(
        "Workflow runs require an owner target preflight before submission",
        "target_admission_required",
      );
    }
    const reviewedRequest = this.targetAdmissionRequests.get(requestId);
    if (!reviewedRequest) {
      throw new ClientError(
        "Run submission requires the target admission request retained by this Studio session",
        "target_admission_missing",
        409,
      );
    }
    validateTargetAdmissionBinding(admission, reviewedRequest);
    assertEqualBindingField("request_id", requestId, admission.request_id);
    assertEqualBindingField("target.instance_id", instanceId, admission.target.instance_id);
    assertEqualBindingField("target.execution_profile", profile, admission.target.execution_profile);
    if (options.target) {
      const reviewedTarget = RunTargetConfigurationSchema.parse(options.target);
      for (const field of TARGET_CONFIGURATION_FIELDS) {
        assertEqualBindingField(`target.${field}`, admission.target[field], reviewedTarget[field]);
      }
    }
    const definitionDigest = await definitionIdentityDigest(parsedDefinition);
    assertEqualBindingField("workflow_definition_digest", admission.workflow_definition_digest, definitionDigest);
    assertEqualBindingField("target.workflow_revision", admission.target.workflow_revision, parsedDefinition.version);
    assertEqualBindingField("target.game_profile", admission.target.game_profile, parsedDefinition.game_profile);
    const response = await this.request("/workflow-runs", {
      method: "POST",
      body: JSON.stringify({
        schema_version: "ascension.management/v1",
        request_id: requestId,
        definition: parsedDefinition,
        artifact_id: null,
        instance_id: instanceId,
        profile,
        admission,
      }),
    });
    return decodeWith(RunSubmissionResponseSchema, response, "run submission");
  }

  public async status(runId: string): Promise<StatusResponse> {
    const response = await this.request(`/workflow-runs/${encodeIdentifier(runId)}`, { method: "GET" });
    return decodeWith(StatusResponseSchema, response, "run status");
  }

  public async events(runId: string, afterSequence: number, limit = 128): Promise<EventPage> {
    const query = new URLSearchParams({ after_sequence: String(afterSequence), limit: String(limit) });
    const response = await this.request(`/workflow-runs/${encodeIdentifier(runId)}/events?${query.toString()}`, { method: "GET" });
    return decodeWith(EventPageSchema, response, "run events");
  }

  public async contextAssociation(runId: string): Promise<ContextAssociation> {
    const response = await this.request(`/workflow-runs/${encodeIdentifier(runId)}/context`, { method: "GET" });
    return decodeWith(ContextAssociationSchema, response, "workflow context association");
  }

  public async providerSessions(runId: string): Promise<ProviderSessionList> {
    const response = await this.request(`/workflow-runs/${encodeIdentifier(runId)}/provider-sessions`, { method: "GET" });
    return decodeWith(ProviderSessionListSchema, response, "workflow provider-session list");
  }

  public async providerSessionPolicy(runId: string): Promise<ProviderSessionPolicyViewResponse> {
    const response = await this.request(`/workflow-runs/${encodeIdentifier(runId)}/provider-session-policy`, { method: "GET" });
    const decoded = decodeWith(ProviderSessionPolicyViewResponseSchema, response, "provider-session policy owner view");
    if (decoded.value.run_id !== runId) {
      throw new ClientError("Provider-session policy owner returned a different workflow run", "provider_session_policy_run_mismatch", 409);
    }
    return decoded;
  }

  public async importProviderSessionPolicy(
    runId: string,
    expectedRevision: number,
    bytes: ArrayBuffer,
  ): Promise<ProviderSessionPolicyCommandResponse> {
    assertPolicyUpload(bytes);
    const query = policyRevisionQuery(expectedRevision);
    const response = await this.request(
      `/workflow-runs/${encodeIdentifier(runId)}/provider-session-policy/import?${query}`,
      { method: "POST", body: bytes },
    );
    return assertPolicyCommandOperation(
      decodeWith(ProviderSessionPolicyCommandResponseSchema, response, "provider-session policy import"),
      "import",
    );
  }

  public async proposeProviderSessionPolicy(
    runId: string,
    proposalId: string,
    sourceSha256: string,
    expectedRevision: number,
    bytes: ArrayBuffer,
  ): Promise<ProviderSessionPolicyCommandResponse> {
    assertPolicyUpload(bytes);
    const query = new URLSearchParams({
      source_sha256: sourceSha256,
      expected_revision: String(expectedRevision),
    });
    const response = await this.request(
      `/workflow-runs/${encodeIdentifier(runId)}/provider-session-policy/proposals/${encodeIdentifier(proposalId)}?${query.toString()}`,
      { method: "POST", body: bytes },
    );
    return assertPolicyCommandOperation(
      decodeWith(ProviderSessionPolicyCommandResponseSchema, response, "provider-session policy proposal"),
      "propose",
    );
  }

  public async approveProviderSessionPolicy(
    runId: string,
    proposalId: string,
    proposalSha256: string,
    approvalRef: string,
    expectedRevision: number,
  ): Promise<ProviderSessionPolicyCommandResponse> {
    return this.providerSessionPolicyCommand(
      runId,
      `/proposals/${encodeIdentifier(proposalId)}/approve`,
      expectedRevision,
      { proposal_sha256: proposalSha256, approval_ref: approvalRef },
      "approve",
    );
  }

  public async adoptProviderSessionPolicyProposal(
    runId: string,
    proposalId: string,
    proposalSha256: string,
    approvalRef: string,
    expectedRevision: number,
  ): Promise<ProviderSessionPolicyCommandResponse> {
    return this.providerSessionPolicyCommand(
      runId,
      `/proposals/${encodeIdentifier(proposalId)}/adopt`,
      expectedRevision,
      { proposal_sha256: proposalSha256, approval_ref: approvalRef },
      "adopt",
    );
  }

  public async adoptImportedProviderSessionPolicy(
    runId: string,
    policySha256: string,
    expectedRevision: number,
  ): Promise<ProviderSessionPolicyCommandResponse> {
    return this.providerSessionPolicyCommand(
      runId,
      "/adoptions",
      expectedRevision,
      { policy_sha256: policySha256 },
      "adopt",
    );
  }

  private async providerSessionPolicyCommand(
    runId: string,
    suffix: string,
    expectedRevision: number,
    body: { proposal_sha256?: string; policy_sha256?: string; approval_ref?: string },
    operation: ProviderSessionPolicyCommandResponse["operation"],
  ): Promise<ProviderSessionPolicyCommandResponse> {
    const query = policyRevisionQuery(expectedRevision);
    const response = await this.request(
      `/workflow-runs/${encodeIdentifier(runId)}/provider-session-policy${suffix}?${query}`,
      {
        method: "POST",
        body: JSON.stringify({
          schema_version: "ascension.provider-session.policy-owner-command.v1",
          ...body,
        }),
      },
    );
    return assertPolicyCommandOperation(
      decodeWith(ProviderSessionPolicyCommandResponseSchema, response, `provider-session policy ${operation}`),
      operation,
    );
  }

  public async command(runId: string, expectedRevision: number, kind: CommandKind, commandId?: string): Promise<CommandResponse> {
    const actorScope = this.actorScope;
    if (!actorScope) {
      throw new ClientError("Configure the authenticated owner subject before sending a command", "actor_scope_required");
    }
    const response = await this.request(`/workflow-runs/${encodeIdentifier(runId)}/commands`, {
      method: "POST",
      body: JSON.stringify({
        schema_version: "ascension.management/v1",
        command_id: commandId ?? `studio.command.${cryptoRandomId()}`,
        run_id: runId,
        expected_revision: expectedRevision,
        actor_scope: actorScope,
        kind,
        parameters: {},
      }),
    });
    return decodeWith(CommandResponseSchema, response, "run command");
  }

  public async replay(runId: string): Promise<ReplayResponse> {
    const response = await this.request(`/workflow-runs/${encodeIdentifier(runId)}/replay`, {
      method: "POST",
      body: JSON.stringify({ schema_version: "ascension.management/v1", run_id: runId, offline: true }),
    });
    return decodeWith(ReplayResponseSchema, response, "run replay");
  }

  public async export(runId: string): Promise<ExportResponse> {
    const response = await this.request(`/workflow-runs/${encodeIdentifier(runId)}/export`, {
      method: "POST",
      body: JSON.stringify({ schema_version: "ascension.management/v1", run_id: runId, redacted: true }),
    });
    return decodeWith(ExportResponseSchema, response, "run export");
  }

  private async request(path: string, init: RequestInit, catalogBody = false): Promise<unknown> {
    const headers = new Headers(init.headers);
    headers.set("accept", "application/json");
    if (init.body !== undefined) {
      headers.set("content-type", "application/json");
    }
    if (this.token) {
      headers.set("authorization", `Bearer ${this.token}`);
    }
    const response = await this.fetcher(`${this.baseUrl}${path}`, {
      ...init,
      headers,
      credentials: "same-origin",
    });
    let body: unknown;
    if (catalogBody) {
      try {
        body = await readContextCatalogBody(response);
      } catch {
        throw new ClientError("Context catalog body is unavailable, malformed, or outside consumer bounds", "context_catalog_invalid", response.status);
      }
    } else {
      body = await response.json().catch(() => undefined);
    }
    if (!response.ok) {
      const decoded = ErrorResponseSchema.safeParse(body);
      throw new ClientError(
        decoded.success ? decoded.data.error.message : `Owner API returned HTTP ${response.status}`,
        decoded.success ? decoded.data.error.code : "http_error",
        response.status,
      );
    }
    return body;
  }
}

function assertPolicyUpload(bytes: ArrayBuffer): void {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_POLICY_UPLOAD_BYTES) {
    throw new ClientError(
      `Policy upload must contain 1 to ${MAX_POLICY_UPLOAD_BYTES} bytes`,
      "provider_session_policy_upload_size",
    );
  }
}

function assertPolicyCommandOperation(
  response: ProviderSessionPolicyCommandResponse,
  expected: ProviderSessionPolicyCommandResponse["operation"],
): ProviderSessionPolicyCommandResponse {
  if (response.operation !== expected) {
    throw new ClientError(
      "Provider-session policy owner returned a different command operation",
      "provider_session_policy_operation_mismatch",
      409,
    );
  }
  return response;
}

function policyRevisionQuery(revision: number): string {
  if (!Number.isSafeInteger(revision) || revision <= 0) {
    throw new ClientError("Policy owner revision must be a positive safe integer", "invalid_revision");
  }
  return new URLSearchParams({ expected_revision: String(revision) }).toString();
}

export function normalizeRelativeBase(baseUrl: string): string {
  if (!baseUrl.startsWith("/")) {
    throw new Error("Studio owner adapters require a same-origin relative API base");
  }
  if (baseUrl.startsWith("//") || baseUrl.includes("\\") || baseUrl.includes("#")) {
    throw new Error("API base contains an unsafe origin or fragment");
  }
  return baseUrl.replace(/\/$/, "");
}

function encodeIdentifier(value: string): string {
  if (!/^[A-Za-z0-9._:-]+$/.test(value)) {
    throw new ClientError("Identifier contains unsupported characters", "invalid_identifier");
  }
  return encodeURIComponent(value);
}

function cryptoRandomId(): string {
  const bytes = new Uint8Array(12);
  globalThis.crypto?.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

function isLiveExecutionProfile(profile: string): boolean {
  return profile === "live" || profile.startsWith("live.");
}

function ownerDefinitionToRecord(owner: import("@studio/contracts").StudioOwnerDefinition): DefinitionRecord {
  const definition = WorkflowDefinitionSchema.parse(owner.definition);
  return DefinitionRecordSchema.parse({
    id: owner.id,
    title: owner.title,
    description: owner.description,
    source: owner.source,
    updatedAt: `revision-${owner.published_revision}`,
    definition,
    capabilities: definition.capabilities.required,
    definitionDigest: owner.definition_digest,
  });
}

function ownerDraftToRecord(owner: import("@studio/contracts").StudioOwnerDraft): DraftRecord {
  const document = WorkflowDefinitionSchema.parse(owner.document);
  const conflict = owner.conflict
    ? {
      serverRevision: owner.conflict.server_revision,
      serverDocument: WorkflowDefinitionSchema.parse(owner.conflict.server_document),
      serverLayout: owner.conflict.server_layout,
    }
    : null;
  return DraftRecordSchema.parse({
    draftId: owner.draft_id,
    definitionId: owner.definition_id,
    revision: owner.revision,
    etag: owner.etag,
    document,
    layout: owner.layout,
    updatedAt: owner.updated_at,
    conflict,
  });
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

export function createProjection(runId: string, definitionDigest: string): RunProjection {
  return { runId, definitionDigest, schemaVersion: "ascension.workflow-event/v1", lastSequence: 0, events: [] };
}

export function applyEventPage(projection: RunProjection, page: EventPage): ProjectionResult {
  if (page.workflow_run_id !== projection.runId) {
    return { kind: "resnapshot", reason: "event page belongs to another run", projection };
  }
  if (page.gap) {
    return { kind: "resnapshot", reason: "owner reported an event retention gap", projection };
  }
  if (page.after_sequence > projection.lastSequence) {
    return { kind: "resnapshot", reason: "event page starts after an unseen sequence", projection };
  }
  if (page.events.length === 0) {
    return { kind: "duplicate", projection };
  }
  const next = {
    ...projection,
    events: [...projection.events],
  };
  let added = 0;
  for (const rawEvent of page.events) {
    const event = decodeWith(RunEventSchema, rawEvent, "event page");
    if (event.schema_version !== projection.schemaVersion || event.workflow_run_id !== projection.runId || event.definition_digest !== projection.definitionDigest) {
      return { kind: "resnapshot", reason: "event identity or definition digest changed", projection };
    }
    const existing = next.events.find((candidate) => candidate.sequence === event.sequence);
    if (existing) {
      if (canonicalJson(existing) !== canonicalJson(event)) {
        return { kind: "resnapshot", reason: "duplicate sequence has conflicting payload", projection };
      }
      continue;
    }
    if (event.sequence !== next.lastSequence + 1) {
      return { kind: "resnapshot", reason: "event sequence is not contiguous", projection };
    }
    next.events.push(event);
    next.lastSequence = event.sequence;
    if (next.events.length > 2048) {
      return { kind: "resnapshot", reason: "event projection exceeded its bounded retention window", projection };
    }
    added += 1;
  }
  if (added === 0) {
    return { kind: "duplicate", projection };
  }
  return { kind: "applied", projection: next, added };
}

export function parseSseDataChunk(chunk: string, maxFrames = 64, maxBytes = 512 * 1024): unknown[] {
  if (new TextEncoder().encode(chunk).byteLength > maxBytes) {
    throw new ClientError("SSE chunk exceeds the bounded transport limit", "sse_oversize");
  }
  const records: unknown[] = [];
  let dataLines: string[] = [];
  const flush = (): void => {
    if (dataLines.length === 0) {
      return;
    }
    if (records.length >= maxFrames) {
      throw new ClientError("SSE chunk exceeds the bounded frame limit", "sse_frame_limit");
    }
    const text = dataLines.join("\n");
    records.push(JSON.parse(text) as unknown);
    dataLines = [];
  };
  for (const line of chunk.split(/\r?\n/)) {
    if (line === "") {
      flush();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart());
    }
  }
  flush();
  return records;
}

export function buildSafeCommand(runId: string, expectedRevision: number, kind: CommandKind): {
  runId: string;
  expectedRevision: number;
  kind: CommandKind;
} {
  if (!/^[A-Za-z0-9._:-]+$/.test(runId) || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
    throw new ClientError("A command requires a qualified run ID and current revision", "unsafe_command");
  }
  return { runId, expectedRevision, kind };
}

export class FixtureClient implements StudioClient {
  public readonly mode = "fixture" as const;
  private readonly definitions: DefinitionRecord[];
  private readonly targetCatalog: TargetCatalogResponse;
  private readonly drafts = new Map<string, DraftRecord>();
  private readonly runs = new Map<string, { definition: WorkflowDefinition; status: StatusResponse; events: RunEvent[] }>();
  private readonly targetAdmissionRequests = new Map<string, TargetAdmissionRequest>();
  private readonly submittedRuns = new Map<string, { fingerprint: string; response: RunSubmissionResponse }>();
  private nextRunNumber = 1;

  public constructor(definitions: DefinitionRecord[], options: { targets?: TargetDescriptor[] } = {}) {
    this.definitions = definitions.map((record) => DefinitionRecordSchema.parse(record));
    const baseCatalog = fixtureTargetCatalog();
    this.targetCatalog = TargetCatalogResponseSchema.parse({
      ...baseCatalog,
      targets: options.targets ?? baseCatalog.targets,
    });
  }

  public principal(): string {
    return "fixture";
  }

  public async listDefinitions(): Promise<DefinitionRecord[]> {
    return this.definitions.map((record) => DefinitionRecordSchema.parse(JSON.parse(JSON.stringify(record)) as unknown));
  }

  public async getDraft(draftId: string): Promise<DraftRecord | undefined> {
    const record = this.drafts.get(draftId);
    return record ? DraftRecordSchema.parse(JSON.parse(JSON.stringify(record)) as unknown) : undefined;
  }

  public async saveDraft(write: DraftWrite): Promise<DraftRecord> {
    const current = this.drafts.get(write.draftId);
    if (current && (current.etag !== write.etag || current.revision !== write.revision)) {
      const conflict: DraftRecord = {
        ...current,
        conflict: {
          serverRevision: current.revision,
          serverDocument: cloneDocument(current.document),
          serverLayout: JSON.parse(JSON.stringify(current.layout)) as JsonObject,
        },
      };
      this.drafts.set(write.draftId, conflict);
      return DraftRecordSchema.parse(JSON.parse(JSON.stringify(conflict)) as unknown);
    }
    const revision = current ? current.revision + 1 : 0;
    const record: DraftRecord = {
      draftId: write.draftId,
      definitionId: write.definitionId,
      revision,
      etag: `fixture-${revision}`,
      document: cloneDocument(write.document),
      layout: JSON.parse(JSON.stringify(write.layout)) as JsonObject,
      updatedAt: new Date().toISOString(),
      conflict: null,
    };
    this.drafts.set(write.draftId, record);
    return DraftRecordSchema.parse(JSON.parse(JSON.stringify(record)) as unknown);
  }

  public async publishDraft(draftId: string, expectedRevision: number, etag: string, definitionDigest: string): Promise<PublishResult> {
    const current = this.drafts.get(draftId);
    if (!current || current.revision !== expectedRevision || current.etag !== etag) {
      return { outcome: "conflict", draft: current ? DraftRecordSchema.parse(JSON.parse(JSON.stringify({ ...current, conflict: { serverRevision: current.revision, serverDocument: current.document, serverLayout: current.layout } })) as unknown) : undefined };
    }
    const digest = await semanticDigest(current.document);
    if (digest !== definitionDigest) {
      return { outcome: "conflict", draft: DraftRecordSchema.parse(JSON.parse(JSON.stringify({ ...current, conflict: { serverRevision: current.revision, serverDocument: current.document, serverLayout: current.layout } })) as unknown) };
    }
    const existing = this.definitions.find((definition) => definition.id === digest);
    if (existing) return { outcome: "already_published", definition: DefinitionRecordSchema.parse(JSON.parse(JSON.stringify(existing)) as unknown) };
    const definition = DefinitionRecordSchema.parse({
      id: digest,
      title: current.document.workflow_id,
      description: `Published revision ${current.document.version}`,
      source: "published",
      updatedAt: current.updatedAt,
      definition: current.document,
      capabilities: current.document.capabilities.required,
    });
    this.definitions.push(definition);
    return { outcome: "published", definition: DefinitionRecordSchema.parse(JSON.parse(JSON.stringify(definition)) as unknown) };
  }

  public async listTargets(): Promise<TargetCatalogResponse> {
    return TargetCatalogResponseSchema.parse(cloneJson(this.targetCatalog));
  }

  public async preflightTarget(request: TargetAdmissionRequest): Promise<TargetPreflightResponse> {
    const body = TargetAdmissionRequestSchema.parse(request);
    const catalog = this.targetCatalog;
    const prior = this.targetAdmissionRequests.get(body.request_id);
    if (prior && canonicalJson(prior) !== canonicalJson(body)) {
      throw new ClientError("The target request ID is already bound to a different configuration", "target_request_conflict", 409);
    }
    const descriptor = catalog.targets.find((target) => target.instance_id === body.target.instance_id);
    if (!descriptor) {
      throw new CapabilityGateError("The selected fixture target is unavailable.", "target_unavailable");
    }
    validateTargetConfiguration(descriptor, body.target);
    const descriptorDigest = await sha256Hex(canonicalJson(descriptor as unknown as JsonObject));
    const admission = TargetAdmissionBindingSchema.parse({
      schema_version: "ascension.workflow-admission/v1",
      request_id: body.request_id,
      workflow_definition_digest: body.workflow_definition_digest,
      target: body.target,
      descriptor_digest: descriptorDigest,
      catalog_revision: catalog.catalog_revision,
    });
    this.targetAdmissionRequests.set(body.request_id, cloneJson(body));
    return TargetPreflightResponseSchema.parse({
      schema_version: "ascension.workflow-admission/v1",
      admission,
    });
  }

  public async health(): Promise<{ status: string }> {
    return { status: "fixture" };
  }

  public async capabilities(): Promise<CapabilityResponse> {
    return {
      schema_version: "ascension.capabilities/v1",
      capabilities: {
        capabilities: ["observe.fair-play.v1", "actions.catalog.v1", "actions.settlement.v1", "studio.fixture.v1"],
        context_bindings: [
          { context_ref: "context.synthetic.v1", node_kinds: ["analyze", "decide"] },
        ],
      },
    };
  }

  public async listContextBindings(): Promise<ContextOwnerCatalog> {
    return fixtureContextOwnerCatalog();
  }

  public async contextOwnerAssociation(_runId: string): Promise<ContextOwnerAssociation> {
    throw new ClientError("The fixture has no current context owner association.", "context_owner_association_unavailable", 503);
  }

  public async contextOwnerEffectiveLimits(_runId: string): Promise<ContextOwnerEffectiveLimits> {
    throw new ClientError("The fixture has no current context owner effective limits.", "context_owner_effective_limits_unavailable", 503);
  }

  public async lookupContextControlReceipt(_runId: string, _command: ContextControlCommand): Promise<ContextControlReceipt> {
    throw new ClientError("The fixture has no historical context control receipt.", "context_control_receipt_not_recorded", 404);
  }

  public async validate(definition: WorkflowDefinition): Promise<ValidateResponse> {
    const diagnostics: ValidateResponse["diagnostics"] = [];
    for (const [graphIndex, graph] of definition.graphs.entries()) {
      const nodeIds = new Set(graph.nodes.map((node) => node.id));
      if (!nodeIds.has(graph.entry_node)) {
        diagnostics.push({ code: "entry_node_missing", severity: "error", path: `$.graphs[${graphIndex}].entry_node`, message: "Entry node is not present in the graph." });
      }
      for (const edge of graph.edges) {
        if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
          diagnostics.push({ code: "edge_endpoint_missing", severity: "error", path: `$.graphs[${graphIndex}].edges`, message: "Every edge endpoint must name a node in the same graph." });
        }
      }
    }
    for (const diagnostic of validateNodeBindings(definition)) {
      diagnostics.push({
        code: diagnostic.code,
        severity: "error",
        path: diagnostic.path,
        message: diagnostic.message,
      });
    }
    const digest = await semanticDigest(definition);
    return {
      schema_version: "ascension.management/v1",
      valid: diagnostics.every((diagnostic) => diagnostic.severity !== "error"),
      definition_digest: digest,
      diagnostics,
    };
  }

  public async inspect(definition: WorkflowDefinition): Promise<InspectResponse> {
    return {
      schema_version: "ascension.management/v1",
      definition_digest: await semanticDigest(definition),
      workflow_id: definition.workflow_id,
      workflow_version: definition.version,
      required_capabilities: definition.capabilities.required,
      graph_count: definition.graphs.length,
      node_count: definition.graphs.reduce((count, graph) => count + graph.nodes.length, 0),
    };
  }

  public async diff(oldDefinition: WorkflowDefinition, newDefinition: WorkflowDefinition): Promise<{
    old_definition_digest: string;
    new_definition_digest: string;
    semantic_change: boolean;
    changed_paths: string[];
  }> {
    const oldDigest = await semanticDigest(oldDefinition);
    const newDigest = await semanticDigest(newDefinition);
    return {
      old_definition_digest: oldDigest,
      new_definition_digest: newDigest,
      semantic_change: oldDigest !== newDigest,
      changed_paths: oldDigest === newDigest ? [] : diffDocuments(oldDefinition, newDefinition).map((change) => change.path),
    };
  }

  public async submitRun(
    definition: WorkflowDefinition,
    instanceId: string,
    profile: string,
    options: RunSubmissionOptions = {},
  ): Promise<RunSubmissionResponse> {
    const parsedDefinition = WorkflowDefinitionSchema.parse(definition);
    const admission = options.admission ? TargetAdmissionBindingSchema.parse(options.admission) : undefined;
    if (!admission) {
      throw new CapabilityGateError(
        "Workflow runs require an owner target preflight before submission",
        "target_admission_required",
      );
    }
    const requestId = options.requestId ?? admission.request_id;
    const reviewedRequest = this.targetAdmissionRequests.get(requestId);
    if (!reviewedRequest) {
      throw new ClientError(
        "Run submission requires a fixture target admission retained by this session",
        "target_admission_missing",
        409,
      );
    }
    validateTargetAdmissionBinding(admission, reviewedRequest);
    assertEqualBindingField("request_id", requestId, admission.request_id);
    assertEqualBindingField("target.instance_id", instanceId, admission.target.instance_id);
    assertEqualBindingField("target.execution_profile", profile, admission.target.execution_profile);
    if (options.target) {
      const reviewedTarget = RunTargetConfigurationSchema.parse(options.target);
      for (const field of TARGET_CONFIGURATION_FIELDS) {
        assertEqualBindingField(`target.${field}`, admission.target[field], reviewedTarget[field]);
      }
    }
    const digest = await definitionIdentityDigest(parsedDefinition);
    assertEqualBindingField("workflow_definition_digest", admission.workflow_definition_digest, digest);
    assertEqualBindingField("target.workflow_revision", admission.target.workflow_revision, parsedDefinition.version);
    assertEqualBindingField("target.game_profile", admission.target.game_profile, parsedDefinition.game_profile);
    const descriptor = this.targetCatalog.targets.find((target) => target.instance_id === admission.target.instance_id);
    if (!descriptor) {
      throw new CapabilityGateError("The selected fixture target is unavailable.", "target_unavailable");
    }
    validateTargetConfiguration(descriptor, admission.target);
    const descriptorDigest = await sha256Hex(canonicalJson(descriptor as unknown as JsonObject));
    assertEqualBindingField("descriptor_digest", admission.descriptor_digest, descriptorDigest);
    assertEqualBindingField("catalog_revision", admission.catalog_revision, this.targetCatalog.catalog_revision);
    const missingCapabilities = parsedDefinition.capabilities.required.filter((capability) => !descriptor.capabilities.includes(capability));
    if (missingCapabilities.length > 0) {
      throw new CapabilityGateError(
        `Fixture target does not advertise required capabilities: ${missingCapabilities.join(", ")}`,
        "target_capability_unavailable",
      );
    }
    const fingerprint = canonicalJson({
      workflow_definition_digest: digest,
      target: admission.target,
      descriptor_digest: admission.descriptor_digest,
      catalog_revision: admission.catalog_revision,
    });
    const existing = this.submittedRuns.get(requestId);
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        throw new ClientError("The run request ID is already bound to a different submission", "run_request_conflict", 409);
      }
      return cloneJson(existing.response);
    }
    const runId = `run.fixture.${this.nextRunNumber}`;
    this.nextRunNumber += 1;
    const snapshot = makeFixtureSnapshot(runId, digest, "running", 1, admission);
    const event = makeFixtureEvent(runId, digest, 1, "run_started", snapshot.cursor.node_execution_id);
    const status: StatusResponse = {
      schema_version: "ascension.workflow-status/v1",
      run: snapshot,
      accepted_plan_revision: null,
      waiting_reason: null,
      authority: { state: "fixture_projection", recovery: "fixture" },
      recovery_admission: { kind: "no_pending_effects" },
      last_progress_sequence: 1,
    };
    this.runs.set(runId, { definition: cloneDocument(parsedDefinition), status, events: [event] });
    const response = { schema_version: "ascension.workflow-run/v1", workflow_run_id: runId, run_revision: 1, status: "running" as const };
    this.submittedRuns.set(requestId, { fingerprint, response });
    return cloneJson(response);
  }

  public async status(runId: string): Promise<StatusResponse> {
    const run = this.runs.get(runId) ?? this.createDefaultRun(runId);
    return JSON.parse(JSON.stringify(run.status)) as StatusResponse;
  }

  public async events(runId: string, afterSequence: number, limit = 128): Promise<EventPage> {
    const run = this.runs.get(runId) ?? this.createDefaultRun(runId);
    const selected = run.events.filter((event) => event.sequence > afterSequence).slice(0, limit);
    return {
      schema_version: "ascension.workflow-event/v1",
      workflow_run_id: runId,
      after_sequence: afterSequence,
      oldest_sequence: run.events[0]?.sequence ?? null,
      newest_sequence: run.events.at(-1)?.sequence ?? null,
      next_after_sequence: selected.at(-1)?.sequence ?? afterSequence,
      gap: null,
      events: JSON.parse(JSON.stringify(selected)) as RunEvent[],
    };
  }

  public async contextAssociation(runId: string): Promise<ContextAssociation> {
    const run = this.runs.get(runId) ?? this.createDefaultRun(runId);
    return ContextAssociationSchema.parse({
      schema_version: "ascension.workflow-context-association/v1",
      workflow: {
        workflow_run_id: run.status.run.workflow_run_id,
        definition_digest: run.status.run.definition_digest,
        graph_id: run.status.run.cursor.graph_id,
        node_id: run.status.run.cursor.node_id,
        node_execution_id: run.status.run.cursor.node_execution_id,
      },
      context: { availability: "not_applicable", context_ref: null, run_id: null, episode_id: null, agent_id: null, snapshot_id: null, approved_revision_id: null, plan_epoch: null, reason_code: "fixture_context_adapter_unavailable" },
      capture: { mode: "unavailable", state: "unavailable", attempt_id: null, reason_code: "fixture_context_adapter_unavailable" },
      capabilities: { inspect_metadata: true, read_retained_content: false, edit_context: false, control_context: false, memory_search: false, provider_session_inspect: false },
    });
  }

  public async providerSessions(runId: string): Promise<ProviderSessionList> {
    const run = this.runs.get(runId) ?? this.createDefaultRun(runId);
    return ProviderSessionListSchema.parse({
      schema: "ascension.provider-session.api-result.v1",
      operation: "list",
      value: { run_id: run.status.run.workflow_run_id, bindings: [], operations: [], next_cursor: null },
      effect_class: "local_metadata_only",
      inference_calls: 0,
      game_effects: 0,
    });
  }

  public async command(runId: string, expectedRevision: number, kind: CommandKind, _commandId?: string): Promise<CommandResponse> {
    const safe = buildSafeCommand(runId, expectedRevision, kind);
    const run = this.runs.get(runId) ?? this.createDefaultRun(runId);
    if (run.status.run.run_revision !== safe.expectedRevision) {
      throw new ClientError("Fixture run revision is stale", "stale_revision", 409);
    }
    const nextRevision = run.status.run.run_revision + 1;
    const status: RunSnapshot["status"] = kind === "pause" ? "paused" : kind === "cancel" ? "cancelled" : kind === "resume" ? "running" : "running";
    run.status.run = { ...run.status.run, run_revision: nextRevision, status };
    run.status.last_progress_sequence += 1;
    const event = makeFixtureEvent(runId, run.status.run.definition_digest, run.status.last_progress_sequence, "command_applied", run.status.run.cursor.node_execution_id);
    run.events.push(event);
    return {
      schema_version: "ascension.management/v1",
      command_id: `fixture.command.${nextRevision}`,
      workflow_run_id: runId,
      outcome: "applied",
      run_revision: nextRevision,
      sequence: event.sequence,
    };
  }

  public async replay(runId: string): Promise<ReplayResponse> {
    const run = this.runs.get(runId) ?? this.createDefaultRun(runId);
    return { schema_version: "ascension.workflow-replay/v1", workflow_run_id: runId, matched: true, compared_events: run.events.length, first_divergence: null };
  }

  public async export(runId: string): Promise<ExportResponse> {
    const run = this.runs.get(runId) ?? this.createDefaultRun(runId);
    return { schema_version: "ascension.workflow-export/v1", workflow_run_id: runId, redacted: true, run: run.status.run, events: run.events };
  }

  private createDefaultRun(runId: string): { definition: WorkflowDefinition; status: StatusResponse; events: RunEvent[] } {
    const definition = this.definitions[0]?.definition;
    if (!definition) {
      throw new ClientError("Fixture catalog has no definition", "fixture_empty");
    }
    const digest = "f".repeat(64);
    const snapshot = makeFixtureSnapshot(runId, digest, "paused", 1);
    const event = makeFixtureEvent(runId, digest, 1, "run_started", snapshot.cursor.node_execution_id);
    const run = {
      definition: cloneDocument(definition),
      status: {
        schema_version: "ascension.workflow-status/v1",
        run: snapshot,
        accepted_plan_revision: null,
        waiting_reason: "Fixture inspection run",
        authority: { state: "fixture_projection", recovery: "fixture" },
        recovery_admission: { kind: "no_pending_effects" as const },
        last_progress_sequence: 1,
      },
      events: [event],
    };
    this.runs.set(runId, run);
    return run;
  }
}

function makeFixtureSnapshot(
  runId: string,
  digest: string,
  status: RunSnapshot["status"],
  revision: number,
  admission?: TargetAdmissionBinding,
): RunSnapshot {
  return {
    schema_version: "ascension.workflow-run/v1",
    workflow_run_id: runId,
    definition_digest: digest,
    run_revision: revision,
    status,
    game_outcome: "not_terminal",
    cursor: { graph_id: "main", node_id: "observe", node_execution_id: `${runId}.node.1` },
    pending_operation: null,
    budget: { provider_calls_consumed: 0, provider_calls_reserved: 0, node_steps_consumed: 1, replans_consumed: 0 },
    cleanup: "not_started",
    ...(admission ? { admission: cloneJson(admission) } : {}),
  };
}

function makeFixtureEvent(runId: string, digest: string, sequence: number, eventType: RunEvent["event_type"], nodeExecutionId: string): RunEvent {
  return {
    schema_version: "ascension.workflow-event/v1",
    workflow_run_id: runId,
    sequence,
    run_revision: sequence,
    event_type: eventType,
    definition_digest: digest,
    node_execution_id: nodeExecutionId,
    payload: { operation_id: null, classification: eventType === "command_applied" ? "settled" : null, reason_code: eventType },
    integrity_digest: null,
  };
}
