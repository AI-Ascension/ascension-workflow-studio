import { describe, expect, it } from "vitest";

import { createLayout } from "@studio/document";
import { fixtureDefinitions } from "../../fixtures/catalog";
import { draftIdFor, initialDraftState, valueKey } from "./draftPersistence";

const definition = fixtureDefinitions[0].definition;

describe("draftPersistence helpers", () => {
  it("derives the owner draft id from the definition id", () => {
    expect(draftIdFor("sts2.setup.strict")).toBe("draft.sts2.setup.strict");
  });

  it("seeds a saved, fixture-backed initial state", () => {
    expect(initialDraftState()).toEqual({
      revision: 0,
      etag: "fixture-0",
      state: "saved",
      message: "Draft changes are local until autosave completes.",
    });
    expect(initialDraftState().server).toBeUndefined();
  });

  it("treats structurally equal candidates as the same persisted value", () => {
    const layout = createLayout(definition, "pending");
    expect(valueKey(definition, layout)).toBe(valueKey(structuredClone(definition), structuredClone(layout)));
  });

  it("distinguishes candidates whose document or layout moved", () => {
    const baseLayout = createLayout(definition, "pending");
    const edited = structuredClone(definition);
    edited.version = "9.9.9";
    expect(valueKey(definition, baseLayout)).not.toBe(valueKey(edited, baseLayout));

    const movedLayout = { ...baseLayout, semanticDigest: "moved" };
    expect(valueKey(definition, baseLayout)).not.toBe(valueKey(definition, movedLayout));
  });
});
