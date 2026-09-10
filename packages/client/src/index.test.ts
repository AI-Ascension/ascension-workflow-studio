import { describe, expect, it } from "vitest";

import type { EventPage, RunEvent } from "@studio/contracts";

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
  });

  it("parses framed SSE data and rejects unsafe command inputs", () => {
    expect(parseSseDataChunk("event: update\ndata: {\"sequence\":1}\n\ndata: {\"sequence\":2}\n\n")).toEqual([{ sequence: 1 }, { sequence: 2 }]);
    expect(buildSafeCommand("run.fixture.1", 3, "pause")).toEqual({ runId: "run.fixture.1", expectedRevision: 3, kind: "pause" });
    expect(() => buildSafeCommand("run/foreign", 3, "pause")).toThrow("qualified run ID");
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
});
