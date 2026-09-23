import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FixtureClient } from "@studio/client";
import { DraftRecordSchema, type ValidateResponse } from "@studio/contracts";
import { createEditGeneration } from "@studio/document";

import { fixtureDefinitions } from "../../fixtures/catalog";
import { initialDraftState, type DraftState } from "./draftState";
import { useDraftPublication, type DraftPublicationOptions } from "./useDraftPublication";

const owner = fixtureDefinitions[0];
const document0 = owner.definition;
const draftId = `draft.${owner.id}`;

function validation(valid: boolean, digest = `sha256:${"a".repeat(64)}`): ValidateResponse {
  return { schema_version: "ascension.validate/v1", valid, definition_digest: digest, compiler: "compiler-1", diagnostics: [] };
}

function baseOptions(draft: DraftState, overrides: Partial<DraftPublicationOptions> = {}): DraftPublicationOptions {
  return {
    client: new FixtureClient(fixtureDefinitions),
    draftId,
    document: document0,
    draft,
    setDraft: vi.fn(),
    editGeneration: { current: createEditGeneration() },
    setValidationState: vi.fn(),
    setValidationMessage: vi.fn(),
    setDiagnostics: vi.fn(),
    ...overrides,
  };
}

afterEach(() => { vi.restoreAllMocks(); });

describe("useDraftPublication", () => {
  it("refuses to publish an unsaved draft and leaves the owner untouched", async () => {
    const client = new FixtureClient(fixtureDefinitions);
    const validate = vi.spyOn(client, "validate");
    const publishDraft = vi.spyOn(client, "publishDraft");
    const setValidationState = vi.fn();
    const setValidationMessage = vi.fn();
    const { result } = renderHook(() => useDraftPublication(baseOptions({ ...initialDraftState(), state: "saving" }, { client, setValidationState, setValidationMessage })));
    await act(async () => { await result.current.publish(); });
    expect(validate).not.toHaveBeenCalled();
    expect(publishDraft).not.toHaveBeenCalled();
    expect(setValidationState).toHaveBeenCalledWith("error");
    expect(setValidationMessage).toHaveBeenCalledWith("Wait for the draft to reach a saved revision before publishing.");
    expect(result.current.publicationState).toBe("idle");
  });

  it("validates then publishes the saved revision with a stable mutation identity", async () => {
    const client = new FixtureClient(fixtureDefinitions);
    vi.spyOn(client, "validate").mockResolvedValue(validation(true));
    const publishDraft = vi.spyOn(client, "publishDraft").mockResolvedValue({ outcome: "published" });
    const setValidationMessage = vi.fn();
    const setValidationState = vi.fn();
    const { result } = renderHook(() => useDraftPublication(baseOptions({ revision: 4, etag: "etag-4", state: "saved", message: "" }, { client, setValidationMessage, setValidationState })));
    await act(async () => { await result.current.publish(); });
    expect(publishDraft).toHaveBeenCalledTimes(1);
    expect(publishDraft.mock.calls[0].slice(0, 4)).toEqual([draftId, 4, "etag-4", `sha256:${"a".repeat(64)}`]);
    expect((publishDraft.mock.calls[0] as unknown as string[])[4]).toMatch(/^studio\.publish\./);
    expect(setValidationMessage).toHaveBeenCalledWith("Published an immutable owner revision.");
    expect(setValidationState).toHaveBeenLastCalledWith("valid");
    expect(result.current.publicationState).toBe("idle");
  });

  it("blocks publication on owner diagnostics", async () => {
    const client = new FixtureClient(fixtureDefinitions);
    vi.spyOn(client, "validate").mockResolvedValue(validation(false));
    const publishDraft = vi.spyOn(client, "publishDraft");
    const setValidationState = vi.fn();
    const setValidationMessage = vi.fn();
    const { result } = renderHook(() => useDraftPublication(baseOptions({ revision: 1, etag: "etag-1", state: "saved", message: "" }, { client, setValidationState, setValidationMessage, setDiagnostics: vi.fn() })));
    await act(async () => { await result.current.publish(); });
    expect(publishDraft).not.toHaveBeenCalled();
    expect(setValidationState).toHaveBeenLastCalledWith("invalid");
    expect(setValidationMessage).toHaveBeenCalledWith("Publication was blocked by owner validation diagnostics.");
  });

  it("maps an owner publication conflict back onto the draft", async () => {
    const client = new FixtureClient(fixtureDefinitions);
    vi.spyOn(client, "validate").mockResolvedValue(validation(true));
    const server = DraftRecordSchema.parse({
      draftId, definitionId: owner.id, revision: 6, etag: "etag-6",
      document: document0, layout: { schemaVersion: "ascension.studio-layout/v1", semanticDigest: "pending", positions: {} },
      updatedAt: "2026-09-23T00:00:00.000Z",
      conflict: { serverRevision: 6, serverDocument: document0, serverLayout: { schemaVersion: "ascension.studio-layout/v1", semanticDigest: "pending", positions: {} } },
    });
    vi.spyOn(client, "publishDraft").mockResolvedValue({ outcome: "conflict", draft: server });
    const setDraft = vi.fn();
    const setValidationMessage = vi.fn();
    const { result } = renderHook(() => useDraftPublication(baseOptions({ revision: 4, etag: "etag-4", state: "saved", message: "" }, { client, setDraft, setValidationMessage })));
    await act(async () => { await result.current.publish(); });
    expect(setDraft).toHaveBeenCalledWith(expect.objectContaining({ revision: 6, etag: "etag-6", state: "conflict", message: "The owner returned a publication conflict.", server }));
    expect(setValidationMessage).toHaveBeenCalledWith("Publication needs conflict resolution before it can create an immutable revision.");
  });
});
