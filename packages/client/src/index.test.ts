import { describe, expect, it } from "vitest";

import type { EventPage, RunEvent, WorkflowDefinition } from "@studio/contracts";

import {
  OwnerApiClient,
  applyEventPage,
  buildSafeCommand,
  createProjection,
  normalizeRelativeBase,
  parseSseDataChunk,
} from "./index";

function event(sequence: number, runId = "run.fixture.1", digest = "digest"): RunEvent {
  return {
    schema_version: "ascension.workflow-event/v1",
    workflow_run_id: runId,
    sequence,
    run_revision: sequence,
    event_type: sequence === 1 ? "run_started" : "node_completed",
    definition_digest: digest,
    node_execution_id: `${runId}.node.${sequence}`,
    payload: { operation_id: null, classification: null, reason_code: "fixture" },
    integrity_digest: null,
  };
}

function page(events: RunEvent[], runId = "run.fixture.1"): EventPage {
  return {
    schema_version: "ascension.workflow-event/v1",
    workflow_run_id: runId,
    after_sequence: events[0] ? events[0].sequence - 1 : 0,
    oldest_sequence: events[0]?.sequence ?? null,
    newest_sequence: events.at(-1)?.sequence ?? null,
    next_after_sequence: events.at(-1)?.sequence ?? 0,
    gap: null,
    events,
  };
}

function workflowDefinition(): WorkflowDefinition {
  return {
    schema_version: "ascension.workflow/v1",
    workflow_id: "owner.workflow",
    version: "1.0.0",
    mode: "strict",
    game_profile: "synthetic",
    policy_ref: "policy.fixture",
    capabilities: { required: [], optional: [] },
    limits: { max_steps: 10, max_subworkflow_depth: 2, max_provider_calls: 2, max_parallel_analyses: 1, max_output_tokens: 128 },
    entry_graph: "main",
    graphs: [{ id: "main", entry_node: "start", nodes: [{ id: "start", kind: "observe", config: {} }], edges: [] }],
  };
}

describe("owner event projection", () => {
  it("applies contiguous events and ignores an exact duplicate", () => {
    const first = event(1);
    const second = event(2);
    const initial = createProjection("run.fixture.1", "digest");
    const applied = applyEventPage(initial, page([first, second]));
    expect(applied.kind).toBe("applied");
    if (applied.kind !== "applied") return;
    expect(applied.projection.lastSequence).toBe(2);
    const duplicate = applyEventPage(applied.projection, page([second]));
    expect(duplicate.kind).toBe("duplicate");
  });

  it("requires a resnapshot for gaps, foreign runs, and conflicting duplicates", () => {
    const initial = createProjection("run.fixture.1", "digest");
    const gap = applyEventPage(initial, page([event(2)]));
    expect(gap.kind).toBe("resnapshot");
    const foreign = applyEventPage(initial, page([event(1, "run.other")], "run.other"));
    expect(foreign.kind).toBe("resnapshot");
    const applied = applyEventPage(initial, page([event(1)]));
    if (applied.kind !== "applied") throw new Error("fixture did not apply");
    const conflicting = applyEventPage(applied.projection, page([{ ...event(1), payload: { ...event(1).payload, reason_code: "tampered" } }]));
    expect(conflicting.kind).toBe("resnapshot");
    const futurePage = applyEventPage(applied.projection, { ...page([event(2)]), after_sequence: 4 });
    expect(futurePage.kind).toBe("resnapshot");
    const schemaPage = applyEventPage(applied.projection, page([{ ...event(2), schema_version: "future/v2" }]));
    expect(schemaPage.kind).toBe("resnapshot");
  });

  it("parses framed SSE data and rejects unsafe command inputs", () => {
    expect(parseSseDataChunk("event: update\ndata: {\"sequence\":1}\n\ndata: {\"sequence\":2}\n\n")).toEqual([{ sequence: 1 }, { sequence: 2 }]);
    expect(buildSafeCommand("run.fixture.1", 3, "pause")).toEqual({ runId: "run.fixture.1", expectedRevision: 3, kind: "pause" });
    expect(() => buildSafeCommand("run/foreign", 3, "pause")).toThrow("qualified run ID");
    expect(() => parseSseDataChunk("data: {}\n\ndata: {}\n\n", 1)).toThrow("frame limit");
  });
});

describe("same-origin client boundary", () => {
  it("accepts only relative API bases", () => {
    expect(normalizeRelativeBase("/v1/")).toBe("/v1");
    expect(() => normalizeRelativeBase("https://example.invalid/v1")).toThrow();
    expect(() => normalizeRelativeBase("//example.invalid/v1")).toThrow();
    expect(() => normalizeRelativeBase("/v1\\escape")).toThrow();
  });

  it("uses a relative URL and decodes owner responses at runtime", async () => {
    const requests: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      requests.push(String(input));
      return new Response(JSON.stringify({ schema_version: "ascension.management/v1", status: "ok" }), { status: 200, headers: { "content-type": "application/json" } });
    };
    const client = new OwnerApiClient({ baseUrl: "/v1", fetcher });
    await expect(client.health()).resolves.toEqual({ status: "ok", schema_version: "ascension.management/v1" });
    expect(requests).toEqual(["/v1/health"]);
  });

  it("rejects a successful HTTP response with an invalid owner shape", async () => {
    const fetcher: typeof fetch = async () => new Response(JSON.stringify({ status: "ok" }), { status: 200 });
    const client = new OwnerApiClient({ baseUrl: "/v1", fetcher });
    await expect(client.health()).rejects.toThrow("health failed runtime decoding");
  });

  it("maps the owner authoring routes into the Studio draft contract", async () => {
    const definition = workflowDefinition();
    const layout = { schemaVersion: "ascension.studio-layout/v1", semanticDigest: "pending", positions: {} };
    const draft = {
      schema_version: "ascension.studio-authoring/v1",
      draft_id: "draft.owner.workflow",
      definition_id: "owner.workflow",
      revision: 0,
      etag: "a".repeat(64),
      document: definition,
      layout,
      updated_at: "revision-0",
      conflict: null,
    };
    const requests: string[] = [];
    const fetcher: typeof fetch = async (input, init) => {
      requests.push(`${init?.method ?? "GET"} ${String(input)}`);
      const path = String(input);
      if (path.endsWith("/studio/definitions")) {
        return new Response(JSON.stringify({ schema_version: "ascension.studio-authoring/v1", definitions: [{ schema_version: "ascension.studio-authoring/v1", id: "published.owner", title: "Owner workflow", description: "Published", source: "published", version: "1.0.0", definition_digest: "b".repeat(64), definition, published_revision: 0 }] }), { status: 200 });
      }
      if (path.endsWith("/studio/drafts/draft.owner.workflow")) {
        if (init?.method === "PUT") {
          return new Response(JSON.stringify({ ...draft, revision: 1, etag: "c".repeat(64), updated_at: "revision-1" }), { status: 200 });
        }
        return new Response(JSON.stringify(draft), { status: 200 });
      }
      return new Response(JSON.stringify({ ...draft, revision: 1, etag: "c".repeat(64), updated_at: "revision-1" }), { status: 200 });
    };
    const client = new OwnerApiClient({ baseUrl: "/v1", fetcher });
    await expect(client.listDefinitions()).resolves.toHaveLength(1);
    await expect(client.getDraft("draft.owner.workflow")).resolves.toMatchObject({ revision: 0, layout });
    await expect(client.saveDraft({ draftId: draft.draft_id, definitionId: draft.definition_id, revision: 0, etag: draft.etag, document: definition, layout, clientMutationId: "mutation-1" })).resolves.toMatchObject({ revision: 1 });
    expect(requests).toEqual([
      "GET /v1/studio/definitions",
      "GET /v1/studio/drafts/draft.owner.workflow",
      "PUT /v1/studio/drafts/draft.owner.workflow",
    ]);
  });

  it("forwards the owner capability manifest during validation", async () => {
    const definition = workflowDefinition();
    let validationBody: Record<string, unknown> | undefined;
    const requests: string[] = [];
    const fetcher: typeof fetch = async (input, init) => {
      const path = String(input);
      requests.push(`${init?.method ?? "GET"} ${path}`);
      if (path.endsWith("/capabilities")) {
        return new Response(JSON.stringify({ schema_version: "ascension.capabilities/v1", capabilities: { capabilities: ["observe.fair-play.v1"] } }), { status: 200 });
      }
      validationBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ schema_version: "ascension.management/v1", valid: true, definition_digest: "a".repeat(64), diagnostics: [] }), { status: 200 });
    };
    const client = new OwnerApiClient({ baseUrl: "/v1", fetcher });
    await expect(client.validate(definition)).resolves.toMatchObject({ valid: true });
    expect(validationBody).toMatchObject({ capabilities: { capabilities: ["observe.fair-play.v1"] } });
    expect(requests).toEqual(["GET /v1/capabilities", "POST /v1/workflow-definitions/validate"]);
  });

  it("requires and forwards the authenticated subject for live commands", async () => {
    let commandBody: Record<string, unknown> | undefined;
    const fetcher: typeof fetch = async (_input, init) => {
      commandBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ schema_version: "ascension.management/v1", command_id: "command-1", workflow_run_id: "run.1", outcome: "accepted", run_revision: 1, sequence: null }), { status: 200 });
    };
    const client = new OwnerApiClient({ baseUrl: "/v1", fetcher });
    await expect(client.command("run.1", 1, "pause")).rejects.toMatchObject({ code: "actor_scope_required" });
    client.setActorScope("profile:studio");
    await client.command("run.1", 1, "pause", "command.stable");
    expect(commandBody).toMatchObject({ actor_scope: "profile:studio", command_id: "command.stable" });
  });
});
