import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CapabilityGateError, FixtureClient } from "@studio/client";
import { DraftRecordSchema, type LayoutSidecar } from "@studio/contracts";
import { createLayout, type SemanticDocument } from "@studio/document";

import { fixtureDefinitions } from "../../fixtures/catalog";
import { draftValueKey } from "./draftState";
import { useDraftPersistence, type DraftPersistenceOptions } from "./useDraftPersistence";

const owner = fixtureDefinitions[0];
const document0 = owner.definition;
const draftId = `draft.${owner.id}`;

function baseOptions(overrides: Partial<DraftPersistenceOptions> = {}): DraftPersistenceOptions {
  return {
    client: new FixtureClient(fixtureDefinitions),
    definitionId: owner.id,
    draftId,
    document: document0,
    layout: createLayout(document0, "pending"),
    initialDocument: document0,
    initialRawText: undefined,
    suspended: false,
    setDocument: vi.fn(),
    setLayout: vi.fn(),
    syncFlowNodes: vi.fn(),
    resetHistory: vi.fn(),
    setFocusedGraph: vi.fn(),
    setGraphTrail: vi.fn(),
    setConflictOpen: vi.fn(),
    setRawText: vi.fn(),
    ...overrides,
  };
}

function record(overrides: { revision?: number; etag?: string; document?: SemanticDocument; layout?: LayoutSidecar } = {}) {
  return DraftRecordSchema.parse({
    draftId,
    definitionId: owner.id,
    revision: overrides.revision ?? 1,
    etag: overrides.etag ?? "etag-1",
    document: overrides.document ?? document0,
    layout: overrides.layout ?? createLayout(document0, "pending"),
    updatedAt: "2026-09-23T00:00:00.000Z",
    conflict: null,
  });
}

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("useDraftPersistence hydration", () => {
  it("adopts the owner-backed draft and records the persisted identity", async () => {
    const client = new FixtureClient(fixtureDefinitions);
    const layout = createLayout(document0, "pending");
    const setDocument = vi.fn();
    const resetHistory = vi.fn();
    await client.saveDraft({ draftId, definitionId: owner.id, revision: 0, etag: "fixture-0", document: document0, layout });
    const options = baseOptions({ client, layout, setDocument, resetHistory });
    const { result } = renderHook(() => useDraftPersistence(options));
    await waitFor(() => expect(result.current.draftHydrated).toBe(true));
    expect(result.current.draftHydrated).toBe(true);
    expect(result.current.draft.state).toBe("saved");
    expect(result.current.draft.message).toBe("Loaded the owner-backed draft.");
    expect(setDocument).toHaveBeenCalledTimes(1);
    expect(resetHistory).toHaveBeenCalledTimes(1);
    expect(result.current.persistedKeyRef.current).toBe(draftValueKey(document0, layout));
  });

  it("surfaces a persisted draft conflict and opens the review", async () => {
    const client = new FixtureClient(fixtureDefinitions);
    const setConflictOpen = vi.fn();
    const conflict = DraftRecordSchema.parse({
      draftId, definitionId: owner.id, revision: 3, etag: "etag-3",
      document: document0, layout: createLayout(document0, "pending"), updatedAt: "2026-09-23T00:00:00.000Z",
      conflict: { serverRevision: 4, serverDocument: document0, serverLayout: createLayout(document0, "pending") },
    });
    vi.spyOn(client, "getDraft").mockResolvedValue(conflict);
    const { result } = renderHook(() => useDraftPersistence(baseOptions({ client, setConflictOpen })));
    await waitFor(() => expect(result.current.draftHydrated).toBe(true));
    expect(result.current.draft.state).toBe("conflict");
    expect(result.current.draft.message).toBe("The owner returned a persisted draft conflict.");
    expect(result.current.draft.server).toEqual(conflict);
    expect(setConflictOpen).toHaveBeenCalledWith(true);
  });

  it("ignores a capability-gated read but reports other load failures as offline", async () => {
    const gated = new FixtureClient(fixtureDefinitions);
    vi.spyOn(gated, "getDraft").mockRejectedValue(new CapabilityGateError("gated"));
    const gatedHook = renderHook(() => useDraftPersistence(baseOptions({ client: gated })));
    await waitFor(() => expect(gatedHook.result.current.draftHydrated).toBe(true));
    expect(gatedHook.result.current.draftHydrated).toBe(true);
    expect(gatedHook.result.current.draft.state).toBe("saved");

    const broken = new FixtureClient(fixtureDefinitions);
    vi.spyOn(broken, "getDraft").mockRejectedValue(new Error("draft read exploded"));
    const brokenHook = renderHook(() => useDraftPersistence(baseOptions({ client: broken })));
    await waitFor(() => expect(brokenHook.result.current.draftHydrated).toBe(true));
    expect(brokenHook.result.current.draftHydrated).toBe(true);
    expect(brokenHook.result.current.draft.state).toBe("offline");
    expect(brokenHook.result.current.draft.message).toBe("draft read exploded");
  });
});

describe("useDraftPersistence autosave", () => {
  it("debounces the write, forwards the revision identity and records the saved key", async () => {
    vi.useFakeTimers();
    const client = new FixtureClient(fixtureDefinitions);
    const save = vi.spyOn(client, "saveDraft");
    const options = baseOptions({ client });
    const { result, rerender } = renderHook((props: DraftPersistenceOptions) => useDraftPersistence(props), { initialProps: options });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    const edited = structuredClone(document0);
    edited.version = "9.9.9";
    const editedLayout = createLayout(edited, "pending");
    rerender({ ...options, document: edited, layout: editedLayout });
    await act(async () => { await vi.advanceTimersByTimeAsync(700); });
    expect(save).toHaveBeenCalledTimes(1);
    const write = save.mock.calls[0][0];
    expect(write).toMatchObject({ draftId, definitionId: owner.id, revision: 0, etag: "fixture-0", document: edited, layout: editedLayout });
    expect(write.clientMutationId).toMatch(/^studio\.mutation\./);
    expect(result.current.draft.state).toBe("saved");
    expect(result.current.draft.message).toBe("Autosaved to the active adapter.");
    expect(result.current.persistedKeyRef.current).toBe(draftValueKey(edited, editedLayout));
  });

  it("suspends autosave while an archival import is open", async () => {
    vi.useFakeTimers();
    const client = new FixtureClient(fixtureDefinitions);
    const save = vi.spyOn(client, "saveDraft");
    const edited = structuredClone(document0);
    edited.version = "9.9.9";
    const options = baseOptions({ client, suspended: true, document: edited, layout: createLayout(edited, "pending") });
    renderHook(() => useDraftPersistence(options));
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    expect(save).not.toHaveBeenCalled();
  });

  it("maps a capability-gated write to offline without changing the identity", async () => {
    vi.useFakeTimers();
    const client = new FixtureClient(fixtureDefinitions);
    vi.spyOn(client, "saveDraft").mockRejectedValue(new CapabilityGateError("gated"));
    const options = baseOptions({ client });
    const { result, rerender } = renderHook((props: DraftPersistenceOptions) => useDraftPersistence(props), { initialProps: options });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    const edited = structuredClone(document0);
    edited.version = "9.9.9";
    rerender({ ...options, document: edited, layout: createLayout(edited, "pending") });
    await act(async () => { await vi.advanceTimersByTimeAsync(700); });
    expect(result.current.draft.state).toBe("offline");
    expect(result.current.draft.message).toBe("Draft persistence is unavailable through the active owner adapter.");
  });

  it("surfaces a save-time revision conflict", async () => {
    vi.useFakeTimers();
    const client = new FixtureClient(fixtureDefinitions);
    const setConflictOpen = vi.fn();
    vi.spyOn(client, "saveDraft").mockResolvedValue(DraftRecordSchema.parse({
      draftId, definitionId: owner.id, revision: 5, etag: "etag-5",
      document: document0, layout: createLayout(document0, "pending"), updatedAt: "2026-09-23T00:00:00.000Z",
      conflict: { serverRevision: 5, serverDocument: document0, serverLayout: createLayout(document0, "pending") },
    }));
    const options = baseOptions({ client, setConflictOpen });
    const { result, rerender } = renderHook((props: DraftPersistenceOptions) => useDraftPersistence(props), { initialProps: options });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    const edited = structuredClone(document0);
    edited.version = "9.9.9";
    rerender({ ...options, document: edited, layout: createLayout(edited, "pending") });
    await act(async () => { await vi.advanceTimersByTimeAsync(700); });
    expect(result.current.draft.state).toBe("conflict");
    expect(result.current.draft.message).toBe("The owner reported a revision conflict.");
    expect(setConflictOpen).toHaveBeenCalledWith(true);
  });
});

describe("useDraftPersistence retry reconciliation", () => {
  it("resolves an offline retry to the owner's already-stored revision", async () => {
    vi.useFakeTimers();
    const client = new FixtureClient(fixtureDefinitions);
    vi.spyOn(client, "saveDraft").mockRejectedValue(new Error("network down"));
    const getDraft = vi.spyOn(client, "getDraft");
    const options = baseOptions({ client });
    const { result, rerender } = renderHook((props: DraftPersistenceOptions) => useDraftPersistence(props), { initialProps: options });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    const edited = structuredClone(document0);
    edited.version = "9.9.9";
    rerender({ ...options, document: edited, layout: createLayout(edited, "pending") });
    await act(async () => { await vi.advanceTimersByTimeAsync(700); });
    expect(result.current.draft.state).toBe("offline");

    getDraft.mockResolvedValue(record({ revision: 7, etag: "etag-7", document: edited }));
    await act(async () => { await result.current.retrySave(); });
    expect(result.current.draft.state).toBe("saved");
    expect(result.current.draft.message).toBe("The owner already stored this candidate; the retry resolved to the existing revision.");
    expect(result.current.draft.revision).toBe(7);
    expect(result.current.persistedKeyRef.current).toBe(draftValueKey(edited, createLayout(edited, "pending")));
  });

  it("turns a moved owner revision into a conflict instead of overwriting", async () => {
    vi.useFakeTimers();
    const client = new FixtureClient(fixtureDefinitions);
    vi.spyOn(client, "saveDraft").mockRejectedValue(new Error("network down"));
    const getDraft = vi.spyOn(client, "getDraft");
    const options = baseOptions({ client });
    const { result, rerender } = renderHook((props: DraftPersistenceOptions) => useDraftPersistence(props), { initialProps: options });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    const edited = structuredClone(document0);
    edited.version = "9.9.9";
    rerender({ ...options, document: edited, layout: createLayout(edited, "pending") });
    await act(async () => { await vi.advanceTimersByTimeAsync(700); });
    expect(result.current.draft.state).toBe("offline");

    const remote = structuredClone(document0);
    remote.version = "99.0.0";
    getDraft.mockResolvedValue(record({ revision: 9, etag: "etag-9", document: remote }));
    await act(async () => { await result.current.retrySave(); });
    expect(result.current.draft.state).toBe("conflict");
    expect(result.current.draft.message).toBe("The owner revision moved while this tab was offline; review the conflict before saving.");
    expect(result.current.draft.server?.revision).toBe(9);
  });
});
