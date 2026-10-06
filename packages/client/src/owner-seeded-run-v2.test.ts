import { afterEach, describe, expect, it, vi } from "vitest";
import { semanticDigest } from "@studio/document";
import type { WorkflowDefinition } from "@studio/contracts";
import {
  OwnerApiClient,
  ownerApiV2BaseFromV1,
  type SeededRunSubmissionOptionsV2,
} from "./index";

const admissionTarget = {
  instance_id: "instance.1",
  execution_profile: "live",
  execution_mode: "live" as const,
  workflow_revision: "1.0.0",
  compatibility_revision: "compat.1",
  capability_revision: "caps.1",
  game_profile: "profile.1",
  save_profile: null,
  inference_profile: null,
  context_capability: null,
  provider_capability: null,
};

function definition(): WorkflowDefinition {
  return {
    schema_version: "ascension.workflow/v1",
    workflow_id: "studio.seeded.workflow",
    version: "1.0.0",
    mode: "strict",
    game_profile: "profile.1",
    policy_ref: "policy.fixture",
    capabilities: { required: [], optional: [] },
    limits: {
      max_steps: 8,
      max_subworkflow_depth: 1,
      max_provider_calls: 0,
      max_parallel_analyses: 1,
      max_output_tokens: 64,
    },
    entry_graph: "main",
    graphs: [{ id: "main", entry_node: "start", nodes: [{ id: "start", kind: "observe", config: {} }], edges: [] }],
  };
}

function seededOptions(requestId: string, mode: "explicit" | "derive_once" = "explicit", seed = "choice.1"): SeededRunSubmissionOptionsV2 {
  return {
    requestId,
    admission: {
      schema_version: "ascension.workflow-admission/v1",
      request_id: requestId,
      workflow_definition_digest: "a".repeat(64),
      target: admissionTarget,
      descriptor_digest: "b".repeat(64),
      catalog_revision: "catalog.1",
    },
    seed: mode === "explicit"
      ? { schema_version: "ascension.workflow-seed-request/v2", mode, seed }
      : { schema_version: "ascension.workflow-seed-request/v2", mode, seed: null },
  };
}

async function preflightBody(client: OwnerApiClient, requestId: string): Promise<SeededRunSubmissionOptionsV2> {
  const digest = await semanticDigest(definition());
  const admission = await client.preflightTarget({
    schema_version: "ascension.workflow-admission/v1",
    request_id: requestId,
    workflow_definition_digest: digest,
    target: admissionTarget,
  });
  return { ...seededOptions(requestId), admission: admission.admission };
}

function responseFor(requestId: string, mode: "explicit" | "derive_once", explicitSeed = "choice.1"): Record<string, unknown> {
  const explicit = mode === "explicit";
  return {
    schema_version: "ascension.workflow-run-submission/v2",
    run: {
      schema_version: "ascension.management/v1",
      workflow_run_id: `run.${requestId}`,
      run_revision: 0,
      status: "created",
    },
    seed_binding: {
      schema_version: "ascension.workflow-seed-binding/v2",
      workflow_run_id: `run.${requestId}`,
      operation_id: `seedop.v2.${requestId}`,
      mode,
      requested_seed: explicit ? explicitSeed : null,
      effective_seed: explicit ? explicitSeed : "derived.choice",
      algorithm_id: explicit ? null : "hmac-sha256-v1",
      key_authority_id: explicit ? null : "authority.1",
      key_version: explicit ? null : "key.1",
      configuration_digest: "c".repeat(64),
      state: "candidate_persisted",
    },
  };
}

function preflightResponse(body: string): Response {
  const request = JSON.parse(body) as Record<string, unknown>;
  return new Response(JSON.stringify({
    schema_version: "ascension.workflow-admission/v1",
    admission: {
      ...request,
      descriptor_digest: "b".repeat(64),
      catalog_revision: "catalog.1",
    },
  }));
}

describe("owner seeded workflow v2 client", () => {
  afterEach(() => vi.useRealTimers());

  it("derives only an exact terminal v2 base and refuses broader or unversioned roots", () => {
    expect(ownerApiV2BaseFromV1("/v1")).toBe("/v2");
    expect(ownerApiV2BaseFromV1("/api/owner/v1")).toBe("/api/owner/v2");
    for (const base of ["/api/v1x", "/api/owner", "/api/owner/v1?x=1", "https://owner.invalid/v1", "/api//v1", "/api/%2e%2e/v1", "/api/@owner/v1"]) {
      expect(() => ownerApiV2BaseFromV1(base)).toThrow();
    }
  });

  it("uses the exact owner preflight and v2 route, checks explicit metadata, and reads the same run binding", async () => {
    const paths: string[] = [];
    const client = new OwnerApiClient({ baseUrl: "/api/owner/v1", token: "owner-token", fetcher: async (input, init) => {
      const path = String(input);
      paths.push(path);
      if (path.endsWith("/workflow-targets/preflight")) return preflightResponse(String(init?.body));
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer owner-token");
      expect(init?.credentials).toBe("same-origin");
      expect(init?.redirect).toBe("error");
      expect(init?.cache).toBe("no-store");
      if (path === "/api/owner/v2/workflow-runs") {
        const sent = JSON.parse(String(init?.body)) as Record<string, unknown>;
        expect(sent).toMatchObject({
          schema_version: "ascension.workflow-run-request/v2",
          request_id: "studio.run.1",
          definition: definition(),
          artifact_id: null,
          instance_id: "instance.1",
          profile: "live",
        });
        expect(sent.admission).toMatchObject({
          descriptor_digest: "b".repeat(64),
          catalog_revision: "catalog.1",
          target: admissionTarget,
        });
        expect(sent.seed).toEqual({ schema_version: "ascension.workflow-seed-request/v2", mode: "explicit", seed: "choice.1" });
        return new Response(JSON.stringify(responseFor("studio.run.1", "explicit")));
      }
      return new Response(JSON.stringify(responseFor("studio.run.1", "explicit").seed_binding));
    } });
    const options = await preflightBody(client, "studio.run.1");
    await expect(client.submitSeededRunV2(definition(), "instance.1", "live", {
      ...options,
      admission: { ...options.admission, descriptor_digest: "d".repeat(64) },
    })).rejects.toMatchObject({ code: "target_binding_mismatch" });
    await expect(client.submitSeededRunV2(definition(), "instance.1", "live", options)).resolves.toMatchObject({
      seed_binding: { mode: "explicit", requested_seed: "choice.1", effective_seed: "choice.1" },
    });
    await expect(client.readSeedBindingV2("run.studio.run.1")).resolves.toMatchObject({
      workflow_run_id: "run.studio.run.1",
      mode: "explicit",
    });
    expect(paths).toEqual([
      "/api/owner/v1/workflow-targets/preflight",
      "/api/owner/v2/workflow-runs",
      "/api/owner/v2/workflow-runs/run.studio.run.1/seed-binding",
    ]);
  });

  it("keeps a valid colon run ID literal and rejects unsafe readback path segments before fetch", async () => {
    const paths: string[] = [];
    const client = new OwnerApiClient({ baseUrl: "/api/owner/v1", fetcher: async (input) => {
      paths.push(String(input));
      const runId = String(input).includes("run:colon") ? "run:colon" : "a".repeat(128);
      return new Response(JSON.stringify({
        ...responseFor("path", "explicit").seed_binding,
        workflow_run_id: runId,
      }));
    } });
    await expect(client.readSeedBindingV2("run:colon")).resolves.toMatchObject({
      workflow_run_id: "run:colon",
    });
    const maxRunId = "a".repeat(128);
    await expect(client.readSeedBindingV2(maxRunId)).resolves.toMatchObject({ workflow_run_id: maxRunId });
    expect(paths).toEqual([
      "/api/owner/v2/workflow-runs/run:colon/seed-binding",
      `/api/owner/v2/workflow-runs/${maxRunId}/seed-binding`,
    ]);
    for (const invalid of ["", "run..escape", "run/slash", "run\\slash", "run%3Acolon", "a".repeat(129)]) {
      await expect(client.readSeedBindingV2(invalid)).rejects.toMatchObject({ code: "invalid_identifier" });
    }
    expect(paths).toHaveLength(2);
  });

  it("omits derive-once null canonically and reuses exact bytes after an ambiguous result", async () => {
    const bodies: string[] = [];
    let postCalls = 0;
    const client = new OwnerApiClient({ baseUrl: "/v1", fetcher: async (input, init) => {
      if (String(input).endsWith("/workflow-targets/preflight")) return preflightResponse(String(init?.body));
      postCalls += 1;
      bodies.push(String(init?.body));
      if (postCalls === 1) throw new TypeError("connection dropped after send");
      return new Response(JSON.stringify(responseFor("studio.derive.1", "derive_once")));
    } });
    const initial = await preflightBody(client, "studio.derive.1");
    const derive = { ...initial, seed: { schema_version: "ascension.workflow-seed-request/v2", mode: "derive_once" as const, seed: null } };
    await expect(client.submitSeededRunV2(definition(), "instance.1", "live", derive))
      .rejects.toMatchObject({ code: "seeded_submission_outcome_unknown" });
    expect(postCalls).toBe(1);
    const parsed = JSON.parse(bodies[0]) as Record<string, unknown>;
    expect(parsed.seed).toEqual({ schema_version: "ascension.workflow-seed-request/v2", mode: "derive_once" });
    expect(Object.hasOwn(parsed.seed as object, "seed")).toBe(false);
    await expect(client.submitSeededRunV2(definition(), "instance.1", "live", {
      ...derive,
      seed: { schema_version: "ascension.workflow-seed-request/v2", mode: "explicit", seed: "different" },
    })).rejects.toMatchObject({ code: "seeded_request_id_conflict" });
    expect(postCalls).toBe(1);
    await expect(client.submitSeededRunV2(definition(), "instance.1", "live", derive))
      .resolves.toMatchObject({ seed_binding: { mode: "derive_once", requested_seed: null, algorithm_id: "hmac-sha256-v1" } });
    expect(bodies[1]).toBe(bodies[0]);
    expect(postCalls).toBe(2);
  });

  it("invalidates v2 preflight when the token or actor session changes without changing v1 submission", async () => {
    const paths: string[] = [];
    const client = new OwnerApiClient({ baseUrl: "/v1", fetcher: async (input, init) => {
      const path = String(input);
      paths.push(path);
      if (path.endsWith("/workflow-targets/preflight")) return preflightResponse(String(init?.body));
      if (path === "/v1/workflow-runs") {
        return new Response(JSON.stringify({ schema_version: "ascension.management/v1", workflow_run_id: "run.legacy", run_revision: 0, status: "created" }));
      }
      return new Response(JSON.stringify(responseFor("session.run", "explicit")));
    } });
    const stale = await preflightBody(client, "session.run");
    client.setToken("new-token");
    await expect(client.submitSeededRunV2(definition(), "instance.1", "live", stale))
      .rejects.toMatchObject({ code: "target_admission_missing" });
    const digest = await semanticDigest(definition());
    const legacyAdmission = await client.preflightTarget({
      schema_version: "ascension.workflow-admission/v1",
      request_id: "legacy.request",
      workflow_definition_digest: digest,
      target: admissionTarget,
    });
    await expect(client.submitRun(definition(), "instance.1", "live", {
      requestId: "legacy.request",
      admission: legacyAdmission.admission,
    }))
      .resolves.toMatchObject({ workflow_run_id: "run.legacy" });
    expect(paths).toEqual([
      "/v1/workflow-targets/preflight",
      "/v1/workflow-targets/preflight",
      "/v1/workflow-runs",
    ]);

    const actorPaths: string[] = [];
    const actorClient = new OwnerApiClient({ baseUrl: "/v1", fetcher: async (input, init) => {
      actorPaths.push(String(input));
      return preflightResponse(String(init?.body));
    } });
    const actorStale = await preflightBody(actorClient, "actor.session.run");
    actorClient.setActorScope("actor.changed");
    await expect(actorClient.submitSeededRunV2(definition(), "instance.1", "live", actorStale))
      .rejects.toMatchObject({ code: "target_admission_missing" });
    expect(actorPaths).toEqual(["/v1/workflow-targets/preflight"]);
  });

  it("does not accept a successful response after the authenticated session changes in flight", async () => {
    let markStarted: (() => void) | undefined;
    let complete: ((response: Response) => void) | undefined;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    const client = new OwnerApiClient({ baseUrl: "/v1", token: "initial", fetcher: async (input, init) => {
      if (String(input).endsWith("/workflow-targets/preflight")) return preflightResponse(String(init?.body));
      markStarted?.();
      return new Promise<Response>((resolve) => { complete = resolve; });
    } });
    const options = await preflightBody(client, "studio.inflight.1");
    const submission = client.submitSeededRunV2(definition(), "instance.1", "live", options);
    await started;
    client.setToken("rotated");
    complete?.(new Response(JSON.stringify(responseFor("studio.inflight.1", "explicit"))));
    await expect(submission).rejects.toMatchObject({ code: "seeded_submission_outcome_unknown" });
  });

  it("does not accept seed readback after the authenticated session changes in flight", async () => {
    let markStarted: (() => void) | undefined;
    let complete: ((response: Response) => void) | undefined;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    const client = new OwnerApiClient({ baseUrl: "/v1", token: "initial", fetcher: async () => {
      markStarted?.();
      return new Promise<Response>((resolve) => { complete = resolve; });
    } });
    const read = client.readSeedBindingV2("run.session.read");
    await started;
    client.setActorScope("actor.changed");
    complete?.(new Response(JSON.stringify(responseFor("session.read", "explicit").seed_binding)));
    await expect(read).rejects.toMatchObject({ code: "seed_binding_read_session_changed" });
  });

  it("fails closed at the unresolved-entry cap and cancels an oversized streamed response", async () => {
    let postCalls = 0;
    const client = new OwnerApiClient({ baseUrl: "/v1", fetcher: async (input, init) => {
      if (String(input).endsWith("/workflow-targets/preflight")) return preflightResponse(String(init?.body));
      postCalls += 1;
      throw new TypeError("unknown outcome");
    } });
    const digest = await semanticDigest(definition());
    for (let index = 0; index < 33; index += 1) {
      const id = `studio.capacity.${index}`;
      await client.preflightTarget({ schema_version: "ascension.workflow-admission/v1", request_id: id, workflow_definition_digest: digest, target: admissionTarget });
      const options = { ...seededOptions(id), admission: {
        schema_version: "ascension.workflow-admission/v1", request_id: id, workflow_definition_digest: digest,
        target: admissionTarget, descriptor_digest: "b".repeat(64), catalog_revision: "catalog.1",
      } };
      await expect(client.submitSeededRunV2(definition(), "instance.1", "live", options))
        .rejects.toMatchObject({ code: index < 32 ? "seeded_submission_outcome_unknown" : "seeded_pending_capacity" });
    }
    expect(postCalls).toBe(32);

    const cancel = vi.fn();
    const oversized = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(1024 * 1024 + 1)); },
      cancel,
    });
    const cancelClient = new OwnerApiClient({ baseUrl: "/v1", fetcher: async (input, init) => {
      if (String(input).endsWith("/workflow-targets/preflight")) return preflightResponse(String(init?.body));
      return new Response(oversized);
    } });
    const boundedOptions = await preflightBody(cancelClient, "studio.large-response");
    await expect(cancelClient.submitSeededRunV2(definition(), "instance.1", "live", boundedOptions))
      .rejects.toMatchObject({ code: "seeded_submission_outcome_unknown" });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("bounds submission time and reports the result as unknown", async () => {
    vi.useFakeTimers();
    let markStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    const client = new OwnerApiClient({ baseUrl: "/v1", fetcher: async (input, init) => {
      if (String(input).endsWith("/workflow-targets/preflight")) return preflightResponse(String(init?.body));
      markStarted?.();
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
      });
    } });
    const options = await preflightBody(client, "studio.timeout.1");
    const pending = client.submitSeededRunV2(definition(), "instance.1", "live", options);
    await started;
    await vi.advanceTimersByTimeAsync(15_001);
    await expect(pending).rejects.toMatchObject({ code: "seeded_submission_outcome_unknown" });
  });

  it("refuses an oversized serialized request before contacting the v2 route", async () => {
    let posts = 0;
    const client = new OwnerApiClient({ baseUrl: "/v1", fetcher: async (input, init) => {
      if (String(input).endsWith("/workflow-targets/preflight")) return preflightResponse(String(init?.body));
      posts += 1;
      return new Response(JSON.stringify(responseFor("studio.large-request", "explicit")));
    } });
    const largeDefinition = { ...definition(), annotations: { payload: "x".repeat(1024 * 1024) } };
    const digest = await semanticDigest(largeDefinition);
    const admission = await client.preflightTarget({
      schema_version: "ascension.workflow-admission/v1",
      request_id: "studio.large-request",
      workflow_definition_digest: digest,
      target: admissionTarget,
    });
    await expect(client.submitSeededRunV2(largeDefinition, "instance.1", "live", {
      ...seededOptions("studio.large-request"), admission: admission.admission,
    })).rejects.toMatchObject({ code: "seeded_request_too_large" });
    expect(posts).toBe(0);

    const stringLimitClient = new OwnerApiClient({ baseUrl: "/v1", fetcher: async (input, init) => {
      if (String(input).endsWith("/workflow-targets/preflight")) return preflightResponse(String(init?.body));
      posts += 1;
      return new Response(JSON.stringify(responseFor("studio.large-string", "explicit")));
    } });
    const stringOptions = await preflightBody(stringLimitClient, "studio.large-string");
    const longStringDefinition = { ...definition(), annotations: { payload: "x".repeat(4097) } };
    await expect(stringLimitClient.submitSeededRunV2(longStringDefinition, "instance.1", "live", stringOptions))
      .rejects.toMatchObject({ code: "seeded_request_invalid" });
    const malformedValue = { ...definition(), annotations: { payload: "value\uD800" } };
    await expect(stringLimitClient.submitSeededRunV2(malformedValue, "instance.1", "live", stringOptions))
      .rejects.toMatchObject({ code: "seeded_request_invalid" });
    const malformedKey = { ...definition(), annotations: { ["key\uD800"]: "value" } };
    await expect(stringLimitClient.submitSeededRunV2(malformedKey, "instance.1", "live", stringOptions))
      .rejects.toMatchObject({ code: "seeded_request_invalid" });
    expect(posts).toBe(0);
  });
});
