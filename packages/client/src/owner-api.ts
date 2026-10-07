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
  InferenceProfileCatalogSchema,
  InferenceProfileRevisionRequestSchema,
  InferenceProfileRevisionResponseSchema,
  ProviderSessionListSchema,
  ProviderSessionPolicyCommandResponseSchema,
  ProviderSessionPolicyViewResponseSchema,
  ReplayResponseSchema,
  RunSubmissionResponseSchema,
  SeedBindingReadbackV2Schema,
  SeedRequestV2Schema,
  SeededRunSubmissionResponseV2Schema,
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
  WorkflowRunRequestV2Schema,
  WORKFLOW_RUN_REQUEST_V2_SCHEMA_VERSION,
  WORKFLOW_SEED_REQUEST_V2_SCHEMA_VERSION,
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
  type InferenceProfileCatalog,
  type InferenceProfileRevisionAdoption,
  type InferenceProfileRevisionRequest,
  type ProviderSessionList,
  type ProviderSessionPolicyCommandResponse,
  type ProviderSessionPolicyViewResponse,
  type ReplayResponse,
  type RunSubmissionResponse,
  type SeedBindingReadbackV2,
  type SeededRunSubmissionResponseV2,
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
  adoptInferenceProfileRevision,
} from "@studio/contracts";
import { definitionIdentityDigest, parseBoundedJson, validateNodeBindings } from "@studio/document";
import { readContextCatalogBody } from "./context-owner-catalog";
import { CapabilityGateError, ClientError } from "./errors";
import { assertPolicyCommandOperation, assertPolicyUpload, policyRevisionQuery } from "./provider-policy";
import { ownerDefinitionToRecord, ownerDraftToRecord } from "./records";
import type { SeededRunSubmissionOptionsV2, SeededRunV2Client } from "./seeded-run-v2";
import { TARGET_CONFIGURATION_FIELDS, assertEqualBindingField, validateTargetAdmissionBinding } from "./targets";
import {
  cloneJson,
  cryptoRandomId,
  encodeIdentifier,
  encodeProfileIdSegment,
  normalizeRelativeBase,
  ownerApiV2BaseFromV1,
  seedRunIdV2PathSegment,
} from "./transport";
import type {
  DraftWrite,
  OwnerApiClientOptions,
  ProviderSessionPolicyClient,
  PublishResult,
  RunSubmissionOptions,
  StudioClient,
} from "./types";

const SEEDED_REQUEST_MAX_BYTES = 1024 * 1024;
const SEEDED_RESPONSE_MAX_BYTES = 1024 * 1024;
const SEEDED_JSON_MAX_DEPTH = 32;
const SEEDED_JSON_MAX_ITEMS = 16 * 1024;
const SEEDED_JSON_MAX_STRING_BYTES = 4 * 1024;
const SEEDED_JSON_MAX_ENCODED_STRING_BYTES = SEEDED_JSON_MAX_STRING_BYTES * 6 + 2;
const SEEDED_SUBMISSION_TIMEOUT_MS = 15_000;
const MAX_UNRESOLVED_SEEDED_SUBMISSIONS = 32;

function assertSeededJsonValueLimits(root: unknown): void {
  const stack: Array<{ value: unknown; depth: number }> = [{ value: root, depth: 0 }];
  let items = 0;
  const encoder = new TextEncoder();
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) break;
    items += 1;
    if (items > SEEDED_JSON_MAX_ITEMS || current.depth > SEEDED_JSON_MAX_DEPTH) {
      throw new Error("JSON item or depth limit exceeded");
    }
    if (typeof current.value === "string") {
      assertWellFormedUtf16(current.value);
      if (encoder.encode(current.value).byteLength > SEEDED_JSON_MAX_STRING_BYTES) {
        throw new Error("JSON string exceeds the owner contract limit");
      }
    } else if (Array.isArray(current.value)) {
      for (const child of current.value) stack.push({ value: child, depth: current.depth + 1 });
    } else if (current.value !== null && typeof current.value === "object") {
      for (const [key, child] of Object.entries(current.value)) {
        assertWellFormedUtf16(key);
        if (encoder.encode(key).byteLength > SEEDED_JSON_MAX_STRING_BYTES) {
          throw new Error("JSON object key exceeds the owner contract limit");
        }
        stack.push({ value: child, depth: current.depth + 1 });
      }
    }
  }
}

function assertWellFormedUtf16(value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (index + 1 >= value.length || next < 0xdc00 || next > 0xdfff) {
        throw new Error("unpaired UTF-16 surrogate");
      }
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      throw new Error("unpaired UTF-16 surrogate");
    }
  }
}

async function readBoundedJson(response: Response, maxBytes: number, signal: AbortSignal): Promise<unknown> {
  if (!response.body) throw new Error("response body unavailable");
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const parts: string[] = [];
  let bytes = 0;
  if (signal.aborted) {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
    throw new Error("request was aborted before response decoding");
  }
  const cancelOnAbort = (): void => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", cancelOnAbort, { once: true });
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) throw new Error("response body exceeds byte limit");
      parts.push(decoder.decode(value, { stream: true }));
    }
    parts.push(decoder.decode());
    const parsed = parseBoundedJson(parts.join(""), {
      maxBytes,
      maxDepth: SEEDED_JSON_MAX_DEPTH,
      maxNodes: SEEDED_JSON_MAX_ITEMS,
      maxStringBytes: SEEDED_JSON_MAX_ENCODED_STRING_BYTES,
    });
    assertSeededJsonValueLimits(parsed);
    return parsed;
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    signal.removeEventListener("abort", cancelOnAbort);
    reader.releaseLock();
  }
}

export class OwnerApiClient implements StudioClient, ProviderSessionPolicyClient, SeededRunV2Client {
  public readonly mode = "live" as const;
  private readonly baseUrl: string;
  private readonly fetcher: typeof fetch;
  private token: string | undefined;
  private actorScope: string | undefined;
  private authGeneration = 0;
  private readonly targetAdmissionGenerations = new Map<string, number>();
  private readonly targetAdmissionBindings = new Map<string, TargetAdmissionBinding>();
  private readonly unresolvedSeededSubmissions = new Map<string, { body: string; generation: number }>();
  /** Requests are retained so a lost response can be retried verbatim. */
  private readonly targetAdmissionRequests = new Map<string, TargetAdmissionRequest>();

  public constructor(options: OwnerApiClientOptions = {}) {
    this.baseUrl = normalizeRelativeBase(options.baseUrl ?? "/v1");
    this.fetcher = options.fetcher ?? fetch.bind(globalThis);
    this.token = options.token;
    this.actorScope = options.actorScope?.trim() || undefined;
  }

  public setToken(token: string | undefined): void {
    const next = token?.trim() || undefined;
    this.authGeneration += 1;
    this.token = next;
  }

  public setActorScope(actorScope: string | undefined): void {
    const next = actorScope?.trim() || undefined;
    this.authGeneration += 1;
    this.actorScope = next;
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

  /** Owner-resolved decision/planner profile catalog. Reading it is
   * `workflow:read` and reaches no provider: only bounded, sealed metadata
   * comes back, and an owner without a catalog reports unavailable rather than
   * substituting one. Integrity here is not authentication — only this
   * authenticated response carries authority. */
  public async listInferenceProfiles(): Promise<InferenceProfileCatalog> {
    const response = await this.request("/inference-profiles", { method: "GET" }, true);
    return decodeWith(InferenceProfileCatalogSchema, response, "inference profile catalog");
  }

  /** Adopts one owner-editable inference-profile revision.
   *
   * This is the WRITE half of the grant split that `listInferenceProfiles`
   * only reads: the owner authorizes this route on `workflow:content:write`
   * and separately checks `descriptor.grants.edit`, neither of which is
   * implied by being able to read the catalog. Calling it for a profile the
   * owner does not publish as editable is therefore refused producer-side
   * (`inference_profile_edit_denied`, HTTP 403) — this method does not
   * pre-empt that refusal with a local guess about what the owner intends.
   *
   * The request is validated locally FIRST, and locally it is CLOSED. A
   * payload carrying an authority or credential field outside the editable
   * allow-list — `adapter`, `requested_model`, `grants`, `node_kinds`,
   * `operations`, an `endpoint`, an `api_key` — fails here and is never sent.
   * That is stricter than the transport would be on its own, and it is the
   * point: a well-formed-looking edit must not be able to smuggle a second
   * intent through a field the owner ignores.
   *
   * A LOST compare-and-swap is returned, not thrown. The owner answers a lost
   * swap with `outcome: "conflict"` and the revision that WON; that is a normal,
   * fully-described outcome of a well-formed request, not an exception. It is
   * surfaced as `conflicted: true` so a caller must handle it explicitly, and
   * there is deliberately no retry here — auto-retrying a lost swap is how a
   * concurrent edit gets silently overwritten by whichever caller retries
   * last. Recovering from a conflict means an explicit human re-author against
   * the named winning revision.
   *
   * Note also what an adoption does NOT do: the owner records the revision in
   * an append-only journal and does NOT splice it into the served catalog. The
   * catalog is re-read to learn what the owner now publishes. */
  public async adoptInferenceProfileRevision(
    profileId: string,
    request: InferenceProfileRevisionRequest,
  ): Promise<InferenceProfileRevisionAdoption> {
    const parsed = InferenceProfileRevisionRequestSchema.parse(request);
    const segment = encodeProfileIdSegment(profileId);
    const response = await this.request(`/inference-profiles/${segment}/revisions`, {
      method: "POST",
      body: JSON.stringify(parsed),
    });
    const decoded = decodeWith(
      InferenceProfileRevisionResponseSchema,
      response,
      "inference profile revision adoption",
    );
    if (decoded.profile_id !== profileId) {
      // The owner keys the journal by the profile in the path. A response for
      // a different profile is not a response to this request.
      throw new ClientError(
        "Owner returned an adoption for a different inference profile",
        "inference_profile_revision_profile_mismatch",
        409,
      );
    }
    return adoptInferenceProfileRevision(decoded);
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
    const generation = this.authGeneration;
    const body = TargetAdmissionRequestSchema.parse(request);
    const response = await this.request("/workflow-targets/preflight", {
      method: "POST",
      body: JSON.stringify(body),
    });
    const result = decodeWith(TargetPreflightResponseSchema, response, "workflow target preflight");
    validateTargetAdmissionBinding(result.admission, body);
    this.targetAdmissionRequests.set(body.request_id, cloneJson(body));
    this.targetAdmissionGenerations.set(body.request_id, generation);
    this.targetAdmissionBindings.set(body.request_id, cloneJson(result.admission));
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

  /** Submit one explicit or derive-once v2 operation. If the outcome is
   * ambiguous, a caller may invoke this again only with the exact same ID and
   * serialized request; the client never invents a replacement ID or retries. */
  public async submitSeededRunV2(
    definition: WorkflowDefinition,
    instanceId: string,
    profile: string,
    options: SeededRunSubmissionOptionsV2,
  ): Promise<SeededRunSubmissionResponseV2> {
    const generation = this.authGeneration;
    const admission = TargetAdmissionBindingSchema.parse(options.admission);
    const requestId = options.requestId;
    const parsedDefinition = WorkflowDefinitionSchema.parse(definition);
    const seed = SeedRequestV2Schema.parse(options.seed);
    if (!requestId || requestId !== admission.request_id) {
      throw new ClientError("Seeded submission request ID must equal its owner admission", "target_binding_mismatch", 409);
    }
    const reviewedRequest = this.targetAdmissionRequests.get(requestId);
    const reviewedBinding = this.targetAdmissionBindings.get(requestId);
    const reviewedGeneration = this.targetAdmissionGenerations.get(requestId);
    if (!reviewedRequest || !reviewedBinding || reviewedGeneration === undefined || reviewedGeneration !== generation) {
      throw new ClientError("Seeded submission requires a current-session target preflight", "target_admission_missing", 409);
    }
    validateTargetAdmissionBinding(admission, reviewedRequest);
    assertEqualBindingField("descriptor_digest", admission.descriptor_digest, reviewedBinding.descriptor_digest);
    assertEqualBindingField("catalog_revision", admission.catalog_revision, reviewedBinding.catalog_revision);
    assertEqualBindingField("request_id", requestId, admission.request_id);
    assertEqualBindingField("target.instance_id", instanceId, admission.target.instance_id);
    assertEqualBindingField("target.execution_profile", profile, admission.target.execution_profile);
    if (options.target) {
      const reviewedTarget = RunTargetConfigurationSchema.parse(options.target);
      for (const field of TARGET_CONFIGURATION_FIELDS) {
        assertEqualBindingField(`target.${field}`, admission.target[field], reviewedTarget[field]);
      }
    }
    const canonicalSeed = seed.mode === "explicit"
      ? { schema_version: WORKFLOW_SEED_REQUEST_V2_SCHEMA_VERSION, mode: "explicit" as const, seed: seed.seed }
      : { schema_version: WORKFLOW_SEED_REQUEST_V2_SCHEMA_VERSION, mode: "derive_once" as const };
    const request = WorkflowRunRequestV2Schema.parse({
      schema_version: WORKFLOW_RUN_REQUEST_V2_SCHEMA_VERSION,
      request_id: requestId,
      definition: parsedDefinition,
      artifact_id: null,
      instance_id: instanceId,
      profile,
      admission,
      seed: canonicalSeed,
    });
    const serializedBody = JSON.stringify(request);
    if (new TextEncoder().encode(serializedBody).byteLength > SEEDED_REQUEST_MAX_BYTES) {
      throw new ClientError("Seeded submission request exceeds the byte limit", "seeded_request_too_large", 413);
    }
    try {
      const parsedRequest = parseBoundedJson(serializedBody, {
        maxBytes: SEEDED_REQUEST_MAX_BYTES,
        maxDepth: SEEDED_JSON_MAX_DEPTH,
        maxNodes: SEEDED_JSON_MAX_ITEMS,
        maxStringBytes: SEEDED_JSON_MAX_ENCODED_STRING_BYTES,
      });
      assertSeededJsonValueLimits(parsedRequest);
    } catch (error) {
      throw new ClientError(
        `Seeded submission request exceeds owner contract limits: ${error instanceof Error ? error.message : "invalid JSON"}`,
        "seeded_request_invalid",
        400,
      );
    }
    if (generation !== this.authGeneration) {
      throw new ClientError("Owner session changed while checking seeded submission", "seeded_session_changed", 409);
    }
    const definitionDigest = await definitionIdentityDigest(parsedDefinition);
    if (generation !== this.authGeneration) {
      throw new ClientError("Owner session changed while checking seeded submission", "seeded_session_changed", 409);
    }
    assertEqualBindingField("workflow_definition_digest", admission.workflow_definition_digest, definitionDigest);
    assertEqualBindingField("target.workflow_revision", admission.target.workflow_revision, parsedDefinition.version);
    assertEqualBindingField("target.game_profile", admission.target.game_profile, parsedDefinition.game_profile);

    const pending = this.unresolvedSeededSubmissions.get(requestId);
    if (pending && (pending.body !== serializedBody || pending.generation !== generation)) {
      throw new ClientError("An unresolved seeded request ID cannot be rebound", "seeded_request_id_conflict", 409);
    }
    if (!pending && this.unresolvedSeededSubmissions.size >= MAX_UNRESOLVED_SEEDED_SUBMISSIONS) {
      throw new ClientError("Too many unresolved seeded submissions; resolve one before starting another", "seeded_pending_capacity", 409);
    }
    this.unresolvedSeededSubmissions.set(requestId, { body: serializedBody, generation });

    let response: Response;
    let body: unknown;
    try {
      ({ response, body } = await this.fetchBoundedV2(
        `/workflow-runs`,
        { method: "POST", body: serializedBody },
        SEEDED_RESPONSE_MAX_BYTES,
        SEEDED_SUBMISSION_TIMEOUT_MS,
      ));
    } catch (error) {
      throw new ClientError(
        `Seeded submission outcome is unknown: ${error instanceof Error ? error.message : "transport failure"}`,
        "seeded_submission_outcome_unknown",
      );
    }
    if (generation !== this.authGeneration) {
      throw new ClientError("Owner session changed while seeded submission was in flight", "seeded_submission_outcome_unknown");
    }
    if (!response.ok) {
      const decoded = ErrorResponseSchema.safeParse(body);
      if (response.status >= 500) {
        throw new ClientError("Seeded submission outcome is unknown after an owner server error", "seeded_submission_outcome_unknown", response.status);
      }
      throw new ClientError(
        decoded.success ? decoded.data.error.message : `Owner API returned HTTP ${response.status}`,
        decoded.success ? decoded.data.error.code : "http_error",
        response.status,
      );
    }
    let result: SeededRunSubmissionResponseV2;
    try {
      result = decodeWith(SeededRunSubmissionResponseV2Schema, body, "seeded run submission");
    } catch (error) {
      throw new ClientError(
        `Seeded submission outcome is unknown because its response was invalid: ${error instanceof Error ? error.message : "invalid response"}`,
        "seeded_submission_outcome_unknown",
        response.status,
      );
    }
    const binding = result.seed_binding;
    if (binding.mode !== seed.mode
      || (seed.mode === "explicit"
        && (binding.requested_seed !== seed.seed || binding.effective_seed !== seed.seed))
      || (seed.mode === "derive_once" && binding.requested_seed !== null)
      || result.run.workflow_run_id !== binding.workflow_run_id) {
      throw new ClientError("Seeded submission response does not match the submitted operation", "seeded_submission_outcome_unknown", response.status);
    }
    if (generation !== this.authGeneration) {
      throw new ClientError("Owner session changed before seeded result acceptance", "seeded_submission_outcome_unknown");
    }
    this.unresolvedSeededSubmissions.delete(requestId);
    return result;
  }

  public async readSeedBindingV2(workflowRunId: string): Promise<SeedBindingReadbackV2> {
    const generation = this.authGeneration;
    const runIdPathSegment = seedRunIdV2PathSegment(workflowRunId);
    let response: { response: Response; body: unknown };
    try {
      response = await this.fetchBoundedV2(
        `/workflow-runs/${runIdPathSegment}/seed-binding`,
        { method: "GET" },
        SEEDED_RESPONSE_MAX_BYTES,
        5_000,
      );
    } catch (error) {
      throw new ClientError(
        `Seed binding read failed: ${error instanceof Error ? error.message : "transport failure"}`,
        "seed_binding_read_failed",
      );
    }
    if (generation !== this.authGeneration) {
      throw new ClientError("Owner session changed while seed binding was being read", "seed_binding_read_session_changed");
    }
    if (!response.response.ok) {
      const decoded = ErrorResponseSchema.safeParse(response.body);
      throw new ClientError(
        decoded.success ? decoded.data.error.message : `Owner API returned HTTP ${response.response.status}`,
        decoded.success ? decoded.data.error.code : "http_error",
        response.response.status,
      );
    }
    const binding = decodeWith(SeedBindingReadbackV2Schema, response.body, "seed binding readback");
    if (binding.workflow_run_id !== workflowRunId) {
      throw new ClientError("Seed binding readback returned a different workflow run", "seed_binding_run_mismatch", 409);
    }
    if (generation !== this.authGeneration) {
      throw new ClientError("Owner session changed before seed binding acceptance", "seed_binding_read_session_changed");
    }
    return binding;
  }

  private async fetchBoundedV2(
    path: string,
    init: RequestInit,
    responseLimit: number,
    timeoutMs: number,
  ): Promise<{ response: Response; body: unknown }> {
    const headers = new Headers(init.headers);
    headers.set("accept", "application/json");
    if (init.body !== undefined) headers.set("content-type", "application/json");
    const token = this.token;
    if (token) headers.set("authorization", `Bearer ${token}`);
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const operation = (async () => {
      const response = await this.fetcher(`${ownerApiV2BaseFromV1(this.baseUrl)}${path}`, {
        ...init,
        headers,
        credentials: "same-origin",
        cache: "no-store",
        redirect: "error",
        signal: controller.signal,
      });
      const body = await readBoundedJson(response, responseLimit, controller.signal);
      return { response, body };
    })();
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error("owner request exceeded its deadline"));
      }, timeoutMs);
    });
    try {
      return await Promise.race([operation, timeout]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
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
