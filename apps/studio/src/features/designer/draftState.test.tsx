import { describe, expect, it } from "vitest";

import { DraftRecordSchema } from "@studio/contracts";
import { createLayout } from "@studio/document";

import { fixtureDefinitions } from "../../fixtures/catalog";
import { conflictRemoteLayoutFor, draftValueKey, initialDraftState } from "./draftState";

const definition = fixtureDefinitions[0];
const document0 = definition.definition;

describe("draftState helpers", () => {
  it("seeds the local-until-autosave lifecycle", () => {
    const state = initialDraftState();
    expect(state).toEqual({ revision: 0, etag: "fixture-0", state: "saved", message: "Draft changes are local until autosave completes." });
    // A fresh object each call so callers never share a mutable draft record.
    expect(initialDraftState()).not.toBe(state);
  });

  it("binds the persisted key to both the document and its layout", () => {
    const layout = createLayout(document0, "pending");
    expect(draftValueKey(document0, layout)).toBe(draftValueKey(document0, layout));
    expect(draftValueKey(document0, layout)).not.toBe(draftValueKey({ ...document0, version: "9.9.9" }, layout));
    expect(draftValueKey(document0, layout)).not.toBe(draftValueKey(document0, createLayout(document0, "digest")));
  });

  it("prefers the owner conflict layout, then the record layout, then a pending layout", () => {
    const base = createLayout(document0, "pending");
    const conflictLayout = createLayout(document0, "digest");
    const withConflict = DraftRecordSchema.parse({
      draftId: `draft.${definition.id}`, definitionId: definition.id, revision: 2, etag: "etag-2",
      document: document0, layout: base, updatedAt: "2026-09-23T00:00:00.000Z",
      conflict: { serverRevision: 3, serverDocument: document0, serverLayout: conflictLayout },
    });
    expect(conflictRemoteLayoutFor(withConflict, document0)).toEqual(conflictLayout);

    const withoutConflictLayout = DraftRecordSchema.parse({
      draftId: `draft.${definition.id}`, definitionId: definition.id, revision: 2, etag: "etag-2",
      document: document0, layout: base, updatedAt: "2026-09-23T00:00:00.000Z", conflict: null,
    });
    expect(conflictRemoteLayoutFor(withoutConflictLayout, document0)).toEqual(base);

    const invalid = DraftRecordSchema.parse({
      draftId: `draft.${definition.id}`, definitionId: definition.id, revision: 2, etag: "etag-2",
      document: document0, layout: { not: "a layout" }, updatedAt: "2026-09-23T00:00:00.000Z", conflict: null,
    });
    expect(conflictRemoteLayoutFor(invalid, document0)).toEqual(createLayout(document0, "pending"));
  });
});
