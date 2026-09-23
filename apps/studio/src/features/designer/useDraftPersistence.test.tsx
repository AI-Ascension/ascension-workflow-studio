import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { type DraftRecord, type JsonObject, type LayoutSidecar, type ValidateResponse } from "@studio/contracts";
import { type StudioClient } from "@studio/client";
import { createEditGeneration, createLayout, type SemanticDocument } from "@studio/document";
import { fixtureDefinitions } from "../../fixtures/catalog";
import {
  useDraftPersistence,
  type DraftPersistenceBridge,
  type DraftPersistenceOptions,
} from "./useDraftPersistence";

const base = fixtureDefinitions[0].definition;
const baseLayout: LayoutSidecar = createLayout(base, "pending");
const draftId = "draft.sts2.setup.strict";

function jsonLayout(layout: LayoutSidecar): JsonObject {
  return structuredClone(layout) as unknown as JsonObject;
}

function record(overrides: Partial<DraftRecord> = {}): DraftRecord {
  return {
    draftId,
    definitionId: "sts2.setup.strict",
    revision: 1,
    etag: "fixture-1",
    document: structuredClone(base),
    layout: jsonLayout(baseLayout),
    updatedAt: "2026-09-23T00:00:00.000Z",
    conflict: null,
    ...overrides,
  };
}

/** Minimal owner adapter covering only the draft/publish surface the hook uses. */
class StubClient {
  public draft?: DraftRecord;
  public loadError?: Error;
  public failNextSave = false;
  public saved: { clientMutationId?: string; revision: number; etag: string }[] = [];
  public published: { clientMutationId?: string }[] = [];
  public validateResult: ValidateResponse = {
    schema_version: "ascension.workflow-validation/v1",
    valid: true,
    definition_digest: "digest.1",
    diagnostics: [],
  };

  public async getDraft(): Promise<DraftRecord | undefined> {
    if (this.loadError) throw this.loadError;
    return this.draft;
  }

  public async saveDraft(write: { clientMutationId?: string; revision: number; etag: string; document: SemanticDocument; layout: unknown; draftId: string }): Promise<DraftRecord> {
    this.saved.push({ clientMutationId: write.clientMutationId, revision: write.revision, etag: write.etag });
    if (this.failNextSave) {
      this.failNextSave = false;
      throw new Error("owner unreachable");
    }
    const next = record({ revision: write.revision + 1, etag: `fixture-${write.revision + 1}`, document: structuredClone(write.document), layout: write.layout as DraftRecord["layout"] });
    this.draft = next;
    return next;
  }

  public async validate(): Promise<ValidateResponse> {
    return this.validateResult;
  }

  public async publishDraft(_id: string, _revision: number, _etag: string, _digest: string, clientMutationId?: string): Promise<{ outcome: "published"; definition: never }> {
    this.published.push({ clientMutationId });
    return { outcome: "published", definition: undefined as never };
  }
}

function bridge(): DraftPersistenceBridge & { replaceDocument: ReturnType<typeof vi.fn>; commitSnapshot: ReturnType<typeof vi.fn>; reportValidation: ReturnType<typeof vi.fn>; setDiagnostics: ReturnType<typeof vi.fn> } {
  return {
    replaceDocument: vi.fn(),
    commitSnapshot: vi.fn(),
    setLayout: vi.fn(),
    reportValidation: vi.fn(),
    setDiagnostics: vi.fn(),
    editGeneration: { current: createEditGeneration() } as DraftPersistenceBridge["editGeneration"],
  } as DraftPersistenceBridge & { replaceDocument: ReturnType<typeof vi.fn>; commitSnapshot: ReturnType<typeof vi.fn>; reportValidation: ReturnType<typeof vi.fn>; setDiagnostics: ReturnType<typeof vi.fn> };
}

function renderController(client: StubClient, bridgeStub = bridge(), overrides: Partial<DraftPersistenceOptions> = {}) {
  return renderHook(
    (props: { document: SemanticDocument }) => useDraftPersistence({
      client: client as unknown as StudioClient,
      definitionId: "sts2.setup.strict",
      initialDocument: base,
      document: props.document,
      layout: baseLayout,
      suspended: false,
      bridge: bridgeStub,
      ...overrides,
    }),
    { initialProps: { document: base } },
  );
}

describe("useDraftPersistence", () => {
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it("hydrates the editor from the owner revision and records the merge base", async () => {
    vi.useFakeTimers();
    const client = new StubClient();
    client.draft = record({ revision: 3, etag: "fixture-3" });
    const bridgeStub = bridge();
    const { result } = renderController(client, bridgeStub);
    await act(async () => {});

    expect(result.current.draft).toMatchObject({ revision: 3, etag: "fixture-3", state: "saved", message: "Loaded the owner-backed draft." });
    expect(bridgeStub.replaceDocument).toHaveBeenCalledWith(client.draft.document, expect.any(Object), { focusEntryGraph: true, updateRawText: true });
  });

  it("surfaces an offline status with the owner error when the load fails", async () => {
    vi.useFakeTimers();
    const client = new StubClient();
    client.loadError = new Error("owner unreachable");
    const { result } = renderController(client);
    await act(async () => {});

    expect(result.current.draft.state).toBe("offline");
    expect(result.current.draft.message).toBe("owner unreachable");
  });

  it("reuses the same mutation identity when retrying an unchanged candidate", async () => {
    vi.useFakeTimers();
    const client = new StubClient();
    client.failNextSave = true;
    const { result } = renderController(client);
    await act(async () => {});
    await act(async () => { await vi.advanceTimersByTimeAsync(700); });

    expect(client.saved).toHaveLength(1);
    expect(result.current.draft.state).toBe("offline");
    const firstMutationId = client.saved[0].clientMutationId;
    expect(firstMutationId).toBeTruthy();

    await act(async () => { await result.current.retrySave(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(700); });

    expect(client.saved).toHaveLength(2);
    expect(client.saved[1].clientMutationId).toBe(firstMutationId);
    expect(result.current.draft.state).toBe("saved");
    expect(result.current.draft.message).toBe("Autosaved to the active adapter.");
  });

  it("mints a new mutation identity once the candidate revision moves", async () => {
    vi.useFakeTimers();
    const client = new StubClient();
    const { result, rerender } = renderController(client);
    await act(async () => {});
    await act(async () => { await vi.advanceTimersByTimeAsync(700); });

    const firstMutationId = client.saved[0].clientMutationId;
    const edited = structuredClone(base);
    edited.version = "9.9.9";
    rerender({ document: edited });
    await act(async () => { await vi.advanceTimersByTimeAsync(700); });

    expect(client.saved).toHaveLength(2);
    expect(client.saved[1].clientMutationId).not.toBe(firstMutationId);
    expect(result.current.draft.state).toBe("saved");
  });

  it("reports an owner revision conflict and reopens the review", async () => {
    vi.useFakeTimers();
    const client = new StubClient();
    vi.spyOn(client, "saveDraft").mockImplementation(async (write) => {
      client.saved.push({ clientMutationId: write.clientMutationId, revision: write.revision, etag: write.etag });
      return record({ revision: 7, etag: "fixture-7", conflict: { serverRevision: 7, serverDocument: structuredClone(base), serverLayout: jsonLayout(baseLayout) } });
    });
    const { result } = renderController(client);
    await act(async () => {});
    await act(async () => { await vi.advanceTimersByTimeAsync(700); });

    expect(result.current.draft.state).toBe("conflict");
    expect(result.current.draft.message).toBe("The owner reported a revision conflict.");
    expect(result.current.draft.server?.revision).toBe(7);
    expect(result.current.conflictOpen).toBe(true);
  });

  it("preserves the candidate when an offline retry finds it already stored", async () => {
    vi.useFakeTimers();
    const client = new StubClient();
    client.failNextSave = true;
    const { result } = renderController(client);
    await act(async () => {});
    await act(async () => { await vi.advanceTimersByTimeAsync(700); });
    expect(result.current.draft.state).toBe("offline");

    client.draft = record({ revision: 4, etag: "fixture-4", document: structuredClone(base), layout: jsonLayout(baseLayout) });
    await act(async () => { await result.current.retrySave(); });

    expect(result.current.draft).toMatchObject({ revision: 4, etag: "fixture-4", state: "saved", message: "The owner already stored this candidate; the retry resolved to the existing revision." });
    expect(client.saved).toHaveLength(1);
  });

  it("blocks publication until the draft reaches a saved revision", async () => {
    vi.useFakeTimers();
    const client = new StubClient();
    vi.spyOn(client, "saveDraft").mockImplementation(async () => record({ conflict: { serverRevision: 1, serverDocument: structuredClone(base), serverLayout: jsonLayout(baseLayout) } }));
    const bridgeStub = bridge();
    const { result } = renderController(client, bridgeStub);
    await act(async () => {});
    await act(async () => { await vi.advanceTimersByTimeAsync(700); });
    expect(result.current.draft.state).toBe("conflict");

    await act(async () => { await result.current.publish(); });

    expect(client.published).toHaveLength(0);
    expect(bridgeStub.reportValidation).toHaveBeenCalledWith("error", "Wait for the draft to reach a saved revision before publishing.");
  });

  it("publishes an immutable owner revision from a saved draft", async () => {
    vi.useFakeTimers();
    const client = new StubClient();
    client.draft = record({ revision: 2, etag: "fixture-2" });
    const bridgeStub = bridge();
    const { result } = renderController(client, bridgeStub);
    await act(async () => {});

    await act(async () => { await result.current.publish(); });

    expect(client.published).toHaveLength(1);
    expect(bridgeStub.reportValidation).toHaveBeenCalledWith("valid", "Published an immutable owner revision.");
    expect(result.current.publicationState).toBe("idle");
  });

  it("resets draft state when the editor is re-seeded", async () => {
    vi.useFakeTimers();
    const client = new StubClient();
    client.draft = record({ revision: 5, etag: "fixture-5" });
    const { result } = renderController(client);
    await act(async () => {});
    expect(result.current.draft.revision).toBe(5);

    act(() => { result.current.reset(base, baseLayout); });

    expect(result.current.draft).toEqual({ revision: 0, etag: "fixture-0", state: "saved", message: "Draft changes are local until autosave completes." });
  });
});
