import {
  CapabilityResponseSchema,
  ContextControlCommandSchema,
  ContextControlReceiptSchema,
  ContextOwnerAssociationSchema,
  ContextOwnerCatalogSchema,
  ContextOwnerEffectiveLimitsSchema,
  ContextAssociationSchema,
  CommandResponseSchema,
  DiffResponseSchema,
  ErrorResponseSchema,
  EventPageSchema,
  ExportResponseSchema,
  HealthResponseSchema,
  InspectResponseSchema,
  ProviderSessionListSchema,
  ProviderSessionPolicyCommandResponseSchema,
  ProviderSessionPolicyViewResponseSchema,
  ReplayResponseSchema,
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
  type ContextOwnerAssociation,
  type ContextOwnerCatalog,
  type ContextOwnerEffectiveLimits,
  type ContextControlCommand,
  type ContextControlReceipt,
  type ContextAssociation,
  type DefinitionRecord,
  type DraftRecord,
  type EventPage,
  type ExportResponse,
  type InspectResponse,
  type ProviderSessionList,
  type ProviderSessionPolicyCommandResponse,
  type ProviderSessionPolicyViewResponse,
  type ReplayResponse,
  type RunSubmissionResponse,
  type StatusResponse,
  type TargetAdmissionBinding,
  type TargetAdmissionRequest,
  type TargetCatalogResponse,
  type TargetPreflightResponse,
  type RunTargetConfiguration,
  type ValidateResponse,
  type WorkflowDefinition,
  type CommandKind,
  type CommandResponse,
} from "@studio/contracts";
import { definitionIdentityDigest, validateNodeBindings } from "@studio/document";
import { readContextCatalogBody } from "./context-owner-catalog";
import { CapabilityGateError, ClientError } from "./errors";
import { assertPolicyCommandOperation, assertPolicyUpload, policyRevisionQuery } from "./provider-policy";
import { ownerDefinitionToRecord, ownerDraftToRecord } from "./records";
import { TARGET_CONFIGURATION_FIELDS, assertEqualBindingField, validateTargetAdmissionBinding } from "./targets";
import { cloneJson, cryptoRandomId, encodeIdentifier, normalizeRelativeBase } from "./transport";
import type {
  DraftWrite,
  OwnerApiClientOptions,
  ProviderSessionPolicyClient,
  PublishResult,
  RunSubmissionOptions,
  StudioClient,
} from "./types";

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
