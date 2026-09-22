import {
  decodeWith,
  RunEventSchema,
  type CommandKind,
  type EventPage,
} from "@studio/contracts";
import { canonicalJson } from "@studio/document";

import { ClientError } from "./errors";
import type { ProjectionResult, RunProjection } from "./types";

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
