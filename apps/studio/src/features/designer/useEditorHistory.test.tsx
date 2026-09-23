import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { fixtureDefinitions } from "../../fixtures/catalog";
import { useEditorHistory } from "./useEditorHistory";

const document0 = fixtureDefinitions[0].definition;

describe("useEditorHistory", () => {
  it("seeds the graph state and snapshot stack from the initial document", () => {
    const { result } = renderHook(() => useEditorHistory(document0));
    expect(result.current.document).toBe(document0);
    expect(result.current.nodes.length).toBeGreaterThan(0);
    expect(result.current.history.current.canUndo()).toBe(false);
    expect(result.current.history.current.canRedo()).toBe(false);
  });

  it("keeps the layout reference stable when every node already has a position", () => {
    const { result } = renderHook(() => useEditorHistory(document0));
    const layout = result.current.layout;
    expect(result.current.ensureLayout(document0, layout)).toBe(layout);
  });

  it("skips redundant flow projections but refreshes on selection changes", () => {
    const { result } = renderHook(() => useEditorHistory(document0));
    act(() => { result.current.syncFlowNodes(document0, result.current.layout, []); });
    const projected = result.current.nodes;
    act(() => { result.current.syncFlowNodes(document0, result.current.layout, []); });
    expect(result.current.nodes).toBe(projected);
    act(() => { result.current.syncFlowNodes(document0, result.current.layout, ["main:decide"]); });
    expect(result.current.nodes).not.toBe(projected);
    expect(result.current.nodes.find((node) => node.id === "main:decide")?.selected).toBe(true);
  });

  it("resets the undo stack when a snapshot is replaced", () => {
    const { result } = renderHook(() => useEditorHistory(document0));
    act(() => { result.current.resetHistory(document0, result.current.layout); });
    expect(result.current.history.current.canUndo()).toBe(false);
  });
});
