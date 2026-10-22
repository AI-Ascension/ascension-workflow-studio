import { afterEach, describe, expect, it, vi } from "vitest";
import { definitionIdentityDigest } from "@studio/document";
import { fixtureDefinitions } from "../../../apps/studio/src/fixtures/catalog";
import { RunSubmissionNotStartedError } from "./errors";
import { FixtureClient } from "./fixture";
import { fixtureTargetCatalog } from "./fixture-catalogs";
import { OwnerApiClient } from "./owner-api";
import type { RunSubmissionOptions } from "./types";

const definition = fixtureDefinitions[0].definition;
const requestId = "studio.run:retained";
const submitted = { schema_version: "ascension.management/v1", workflow_run_id: "run.original", run_revision: 1, status: "running" };
const missing = { schema_version: "ascension.workflow-submission/v1", request_id: requestId, state: "missing", workflow_run_id: null, response: null, error: null };
const failure = { class: "unresolved", code: "live_launch_failed", message: "Inspect the retained run" };
const recovered = { ...missing, state: "submitted", workflow_run_id: submitted.workflow_run_id, response: submitted };
type Handler = (init?: RequestInit) => Response | Promise<Response>;

async function setup(post: Handler, get: Handler = () => Response.json(missing)) {
  const fixture = new FixtureClient(fixtureDefinitions);
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    if (path.endsWith("/workflow-targets/preflight")) return Response.json(await fixture.preflightTarget(JSON.parse(String(init?.body))));
    if (path.endsWith("/health")) return Response.json({ schema_version: "ascension.management/v1", status: "ok" });
    return init?.method === "GET" ? get(init) : post(init);
  });
  const client = new OwnerApiClient({ fetcher, token: " synthetic-test-token ", actorScope: " test-owner " });
  const descriptor = fixtureTargetCatalog().targets[0];
  const target = {
    instance_id: descriptor.instance_id, execution_profile: descriptor.execution_profiles[0],
    execution_mode: descriptor.execution_mode, workflow_revision: definition.version,
    compatibility_revision: descriptor.compatibility_revision, capability_revision: descriptor.capability_revision,
    game_profile: definition.game_profile, save_profile: null, inference_profile: null,
    context_capability: null, provider_capability: null,
  };
  const admission = await client.preflightTarget({
    schema_version: "ascension.workflow-admission/v1", request_id: requestId,
    workflow_definition_digest: await definitionIdentityDigest(definition), target,
  });
  const options: RunSubmissionOptions = { requestId, admission: admission.admission, target };
  return {
    client, fetcher, options,
    submit: () => client.submitRun(definition, target.instance_id, target.execution_profile, options),
    posts: () => fetcher.mock.calls.filter(([url]) => String(url).endsWith("/workflow-runs")),
    reads: () => fetcher.mock.calls.filter(([url]) => String(url).includes("/workflow-submissions/")),
  };
}

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe("owner original-request submission recovery", () => {
  it("keeps a post-launch 409 and recovers the original run without another POST", async () => {
    const s = await setup(() => Response.json({ schema_version: "ascension.management/v1", error: failure }, { status: 409 }), () => Response.json(recovered));
    await expect(s.submit()).rejects.toMatchObject({ code: failure.code, status: 409, errorClass: "unresolved" });
    await expect(s.submit()).rejects.toMatchObject({ code: "submission_recovery_required" });
    expect(await s.client.recoverRunSubmission(requestId)).toEqual(recovered);
    expect(s.posts()).toHaveLength(1);
    const [url, init] = s.reads()[0];
    expect(url).toBe("/v1/workflow-submissions/studio.run:retained");
    expect(init).toMatchObject({ method: "GET", credentials: "same-origin", redirect: "error", cache: "no-store" });
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer synthetic-test-token");
    expect(init?.body).toBeUndefined();
  });

  it("allows only an explicit missing readback to retry exactly the same bytes", async () => {
    let calls = 0;
    const s = await setup(() => { if (++calls === 1) throw new Error("lost reply"); return Response.json(submitted); });
    await expect(s.submit()).rejects.toThrow("lost reply");
    await expect(s.submit()).rejects.toMatchObject({ code: "submission_recovery_required" });
    expect(await s.client.recoverRunSubmission(requestId)).toEqual(missing);
    expect(s.posts()).toHaveLength(1);
    expect(await s.submit()).toEqual(submitted);
    expect(s.posts()).toHaveLength(2);
    expect(s.posts()[1][1]?.body).toBe(s.posts()[0][1]?.body);
  });

  it.each([
    { state: "pending", workflow_run_id: null, error: null },
    { state: "pending", workflow_run_id: "run.reserved", error: null },
    { state: "failed", workflow_run_id: null, error: failure },
    { state: "failed", workflow_run_id: "run.reserved", error: failure },
  ])("retains $state with run $workflow_run_id without permitting a new POST", async (state) => {
    const result = { ...missing, ...state };
    const s = await setup(() => { throw new Error("lost"); }, () => Response.json(result));
    await expect(s.submit()).rejects.toThrow("lost");
    expect(await s.client.recoverRunSubmission(requestId)).toEqual(result);
    await expect(s.submit()).rejects.toMatchObject({ code: "submission_recovery_required" });
    expect(s.posts()).toHaveLength(1);
  });

  it.each([400, 401, 403, 404, 409, 503])("does not treat HTTP %i on recovery as missing", async (status) => {
    const s = await setup(() => { throw new Error("lost"); }, () => Response.json({ schema_version: "ascension.management/v1", error: failure }, { status }));
    await expect(s.submit()).rejects.toThrow("lost");
    await expect(s.client.recoverRunSubmission(requestId)).rejects.toMatchObject({ status });
    await expect(s.submit()).rejects.toMatchObject({ code: "submission_recovery_required" });
    expect(s.posts()).toHaveLength(1);
  });

  it.each([
    { ...missing, request_id: "different" },
    { ...missing, schema_version: "ascension.workflow-submission/v2" },
    { ...missing, workflow_run_id: "contradiction" },
    { ...missing, extra: true },
    { ...recovered, workflow_run_id: "different" },
    { ...recovered, response: { ...submitted, run_revision: Number.MAX_SAFE_INTEGER + 1 } },
  ])("retains unknown after invalid or uncorrelated recovery %#", async (body) => {
    const s = await setup(() => { throw new Error("lost"); }, () => Response.json(body));
    await expect(s.submit()).rejects.toThrow("lost");
    await expect(s.client.recoverRunSubmission(requestId)).rejects.toThrow();
    await expect(s.submit()).rejects.toMatchObject({ code: "submission_recovery_required" });
    expect(s.posts()).toHaveLength(1);
  });

  it.each([
    JSON.stringify({ ...submitted, schema_version: "ascension.management/v2" }),
    JSON.stringify({ ...submitted, workflow_run_id: "" }),
    JSON.stringify({ ...submitted, workflow_run_id: "x".repeat(129) }),
    JSON.stringify({ ...submitted, run_revision: Number.MAX_SAFE_INTEGER + 1 }),
    '{"schema_version":"ascension.management/v1","workflow_run_id":"run.a","workflow_run_id":"run.b","run_revision":1,"status":"running"}',
    "[".repeat(33) + "0" + "]".repeat(33),
    JSON.stringify(Array.from({ length: 16 * 1024 }, () => 0)),
    JSON.stringify("x".repeat(65536)),
    new Uint8Array([0xc3, 0x28]),
  ])("retains unknown after malformed or unbounded successful POST bytes %#", async (body) => {
    const s = await setup(() => new Response(body));
    await expect(s.submit()).rejects.toThrow();
    await expect(s.submit()).rejects.toMatchObject({ code: "submission_recovery_required" });
    expect(s.posts()).toHaveLength(1);
  });

  it("preserves the separate v2 write_state_unknown envelope", async () => {
    const s = await setup(() => Response.json({
      schema_version: "ascension.management-error/v2",
      error: { class: "write_state_unknown", code: "dispatch_deadline_exceeded", message: "Check original identity" },
    }, { status: 503 }));
    await expect(s.submit()).rejects.toMatchObject({ errorClass: "write_state_unknown", status: 503 });
    await expect(s.submit()).rejects.toMatchObject({ code: "submission_recovery_required" });
  });

  it("marks a changed session before the first POST as definitely not started", async () => {
    const s = await setup(() => Response.json(submitted));
    s.client.setToken(undefined);
    const error = await s.submit().catch((error: unknown) => error);
    expect(error).toBeInstanceOf(RunSubmissionNotStartedError);
    expect(error).toMatchObject({ code: "submission_session_changed", status: 409 });
    expect(s.posts()).toHaveLength(0);
    await expect(s.client.recoverRunSubmission(requestId)).rejects.toMatchObject({ code: "submission_not_retained" });
  });

  it("preserves recovery when a health check reapplies identical normalized credentials", async () => {
    const s = await setup(() => { throw new Error("lost"); }, () => Response.json(recovered));
    s.client.setToken("synthetic-test-token");
    s.client.setActorScope("test-owner");
    await expect(s.submit()).rejects.toThrow("lost");
    s.client.setToken(" synthetic-test-token ");
    s.client.setActorScope(" test-owner ");
    expect(await s.client.health()).toMatchObject({ status: "ok" });
    expect(await s.client.recoverRunSubmission(requestId)).toEqual(recovered);
    expect(s.posts()).toHaveLength(1);
  });

  it.each(["token", "actor"] as const)("fences %s A to B to A despite the final value matching", async (credential) => {
    const s = await setup(() => { throw new Error("lost"); });
    await expect(s.submit()).rejects.toThrow("lost");
    if (credential === "token") { s.client.setToken("other"); s.client.setToken("synthetic-test-token"); }
    else { s.client.setActorScope("other"); s.client.setActorScope("test-owner"); }
    await expect(s.client.recoverRunSubmission(requestId)).rejects.toMatchObject({ code: "submission_session_changed" });
    expect(s.reads()).toHaveLength(0);
  });

  it("does not adopt a POST receipt if transport cleanup changes credentials", async () => {
    const s = await setup((init) => {
      init?.signal?.addEventListener("abort", () => s.client.setToken("different-token"), { once: true });
      return Response.json(submitted);
    });
    await expect(s.submit()).rejects.toMatchObject({ code: "submission_session_changed" });
    await expect(s.client.recoverRunSubmission(requestId)).rejects.toMatchObject({ code: "submission_session_changed" });
    expect(s.posts()).toHaveLength(1);
    expect(s.reads()).toHaveLength(0);
  });

  it.each([recovered, missing])("does not adopt $state readback if transport cleanup changes credentials", async (result) => {
    const s = await setup(() => { throw new Error("lost"); }, (init) => {
      init?.signal?.addEventListener("abort", () => s.client.setToken("different-token"), { once: true });
      return Response.json(result);
    });
    await expect(s.submit()).rejects.toThrow("lost");
    await expect(s.client.recoverRunSubmission(requestId)).rejects.toMatchObject({ code: "submission_session_changed" });
    await expect(s.client.recoverRunSubmission(requestId)).rejects.toMatchObject({ code: "submission_session_changed" });
    expect(s.posts()).toHaveLength(1);
    expect(s.reads()).toHaveLength(1);
  });

  it("rejects a receipt arriving after an authentication change", async () => {
    let resolve!: (response: Response) => void;
    const s = await setup(() => new Promise<Response>((done) => { resolve = done; }));
    const operation = s.submit();
    await vi.waitFor(() => expect(s.posts()).toHaveLength(1));
    s.client.setActorScope("other-owner");
    resolve(Response.json(submitted));
    await expect(operation).rejects.toMatchObject({ code: "submission_session_changed" });
    await expect(s.client.recoverRunSubmission(requestId)).rejects.toMatchObject({ code: "submission_session_changed" });
    expect(s.reads()).toHaveLength(0);
  });

  it("refuses concurrent POST and recovery operations for a retained identity", async () => {
    let resolve!: (response: Response) => void;
    const s = await setup(() => new Promise<Response>((done) => { resolve = done; }));
    const first = s.submit();
    await vi.waitFor(() => expect(s.posts()).toHaveLength(1));
    await expect(s.submit()).rejects.toMatchObject({ code: "submission_recovery_required" });
    await expect(s.client.recoverRunSubmission(requestId)).rejects.toMatchObject({ code: "submission_in_flight" });
    resolve(Response.json(submitted));
    expect(await first).toEqual(submitted);
    expect(s.posts()).toHaveLength(1);
    expect(s.reads()).toHaveLength(0);
  });

  it("revokes a previous missing retry permission when a new recovery read fails", async () => {
    let reads = 0;
    const s = await setup(() => { throw new Error("lost"); }, () => ++reads === 1 ? Response.json(missing) : Response.json({}, { status: 404 }));
    await expect(s.submit()).rejects.toThrow("lost");
    await s.client.recoverRunSubmission(requestId);
    await expect(s.client.recoverRunSubmission(requestId)).rejects.toMatchObject({ status: 404 });
    await expect(s.submit()).rejects.toMatchObject({ code: "submission_recovery_required" });
    expect(s.posts()).toHaveLength(1);
  });

  it("bounds a fetcher that never settles and retains the aborted request", async () => {
    vi.useFakeTimers();
    const s = await setup(() => new Promise<Response>(() => {}));
    const operation = s.submit();
    const result = expect(operation).rejects.toMatchObject({ code: "submission_timeout" });
    await vi.waitFor(() => expect(s.posts()).toHaveLength(1));
    await vi.advanceTimersByTimeAsync(45_001);
    await result;
    expect(s.posts()[0][1]?.signal?.aborted).toBe(true);
    await expect(s.submit()).rejects.toMatchObject({ code: "submission_recovery_required" });
  });
});
