import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FixtureClient } from "@studio/client";
import { DraftRecordSchema, type ValidateResponse } from "@studio/contracts";
import { createEditGeneration, createLayout, type SemanticDocument } from "@studio/document";

import { fixtureDefinitions } from "../../fixtures/catalog";
import { draftValueKey, type DraftState } from "./draftState";
import { useDraftConflict, type DraftConflictOptions } from "./useDraftConflict";

const owner = fixtureDefinitions[0];
const document0 = owner.definition;
const draftId = `draft.${owner.id}`;

function conflictRecord(remote: SemanticDocument) {
  return DraftRecordSchema.parse({
    draftId, definitionId: owner.id, revision: 4, etag: "etag-4",
    document: document0, layout: createLayout(document0, "pending"), updatedAt: "2026-09-23T00:00:00.000Z",
    conflict: { serverRevision: 5, serverDocument: remote, serverLayout: createLayout(remote, "pending") },
  });
}

function baseOptions(overrides: Partial<DraftConflictOptions> = {}): DraftConflictOptions {
  const server = conflictRecord(document0);
  return {
    client: new FixtureClient(fixtureDefinitions),
    definitionId: owner.id,
    draftId,
    draft: { revision: 4, etag: "etag-4", state: "conflict", message: "", server } satisfies DraftState,
    setDraft: vi.fn(),
    document: document0,
    layout: createLayout(document0, "pending"),
    setDocument: vi.fn(),
    setLayout: vi.fn(),
    syncFlowNodes: vi.fn(),
    resetHistory: vi.fn(),
    setRawText: vi.fn(),
    commitSnapshot: vi.fn(),
    setConflictOpen: vi.fn(),
    editGeneration: { current: createEditGeneration() },
    setValidationState: vi.fn(),
    setValidationMessage: vi.fn(),
    setDiagnostics: vi.fn(),
    mergeBaseRef: { current: document0 },
    mergeBaseLayoutRef: { current: createLayout(document0, "pending") },
    persistedKeyRef: { current: undefined },
    ...overrides,
  };
}

afterEach(() => { vi.restoreAllMocks(); });

describe("useDraftConflict", () => {
  it("derives the remote candidate from the owner conflict record", () => {
    const remote = structuredClone(document0);
    remote.version = "42.0.0";
    const { result } = renderHook(() => useDraftConflict(baseOptions({ draft: { revision: 4, etag: "etag-4", state: "conflict", message: "", server: conflictRecord(remote) } })));
    expect(result.current.conflictRemoteDocument).toEqual(remote);
    expect(result.current.conflictRemoteLayout).toEqual(createLayout(remote, "pending"));
  });

  it("reloads the remote revision and drops the local conflict", () => {
    const remote = structuredClone(document0);
    remote.version = "42.0.0";
    const remoteLayout = createLayout(remote, "pending");
    const setDocument = vi.fn();
    const setRawText = vi.fn();
    const persistedKeyRef: { current: string | undefined } = { current: undefined };
    const setDraft = vi.fn();
    const { result } = renderHook(() => useDraftConflict(baseOptions({
      draft: { revision: 4, etag: "etag-4", state: "conflict", message: "", server: conflictRecord(remote) },
      setDocument, setRawText, persistedKeyRef, setDraft,
    })));
    act(() => { result.current.reloadRemoteConflict(); });
    expect(setDocument).toHaveBeenCalledWith(remote);
    expect(setRawText).toHaveBeenCalledWith(JSON.stringify(remote, null, 2));
    expect(persistedKeyRef.current).toBe(draftValueKey(remote, remoteLayout));
    expect(setDraft).toHaveBeenCalledWith(expect.objectContaining({ revision: 4, etag: "etag-4", state: "saved", message: "Remote revision loaded; local conflict was discarded." }));
  });

  it("preserves the local candidate by saving it as a new draft", async () => {
    const client = new FixtureClient(fixtureDefinitions);
    const save = vi.spyOn(client, "saveDraft");
    const setDraft = vi.fn();
    const { result } = renderHook(() => useDraftConflict(baseOptions({ client, setDraft })));
    await act(async () => { await result.current.saveLocalAsNew(); });
    expect(save).toHaveBeenCalledTimes(1);
    const write = save.mock.calls[0][0];
    expect(write.draftId).toMatch(new RegExp(`^draft\\.${owner.id.replaceAll(".", "\\.")}\\.copy\\.\\d+$`));
    expect(write).toMatchObject({ definitionId: owner.id, revision: 0, etag: "fixture-0", document: document0 });
    expect(write.clientMutationId).toMatch(/^studio\.copy\./);
    expect(setDraft).toHaveBeenCalledWith(expect.objectContaining({ state: "saved", message: "Local candidate was saved as a new draft." }));
  });

  it("commits and revalidates a clean non-overlapping merge", async () => {
    const remote = structuredClone(document0);
    remote.version = "42.0.0";
    const client = new FixtureClient(fixtureDefinitions);
    const result: ValidateResponse = { schema_version: "ascension.validate/v1", valid: true, definition_digest: `sha256:${"b".repeat(64)}`, compiler: "compiler-1", diagnostics: [] };
    vi.spyOn(client, "validate").mockResolvedValue(result);
    const commitSnapshot = vi.fn();
    const setValidationMessage = vi.fn();
    const hook = renderHook(() => useDraftConflict(baseOptions({
      client, commitSnapshot, setValidationMessage,
      draft: { revision: 4, etag: "etag-4", state: "conflict", message: "", server: conflictRecord(remote) },
    })));
    await act(async () => { await hook.result.current.mergeConflict(); });
    expect(commitSnapshot).toHaveBeenCalledTimes(1);
    expect(commitSnapshot.mock.calls[0][0]).toMatchObject({ workflow_id: remote.workflow_id, version: "42.0.0" });
    expect(setValidationMessage).toHaveBeenCalledWith(expect.stringContaining("Merged semantic and layout candidates revalidated at"));
  });

  it("refuses a merge that still conflicts and never commits it", async () => {
    const remote = structuredClone(document0);
    remote.version = "42.0.0";
    const local = structuredClone(document0);
    local.version = "9.9.9";
    const client = new FixtureClient(fixtureDefinitions);
    const commitSnapshot = vi.fn();
    const setValidationState = vi.fn();
    const setValidationMessage = vi.fn();
    const hook = renderHook(() => useDraftConflict(baseOptions({
      client, commitSnapshot, setValidationState, setValidationMessage, document: local,
      draft: { revision: 4, etag: "etag-4", state: "conflict", message: "", server: conflictRecord(remote) },
    })));
    await act(async () => { await hook.result.current.mergeConflict(); });
    expect(commitSnapshot).not.toHaveBeenCalled();
    expect(setValidationState).toHaveBeenCalledWith("error");
    expect(setValidationMessage).toHaveBeenCalledWith(expect.stringContaining("Merge needs review at"));
  });

  it("cancels resolution without discarding either candidate", () => {
    const setConflictOpen = vi.fn();
    const { result } = renderHook(() => useDraftConflict(baseOptions({ setConflictOpen })));
    act(() => { result.current.cancelConflictResolution(); });
    expect(setConflictOpen).toHaveBeenCalledWith(false);
  });
});
