import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { type SemanticDocument } from "@studio/document";
import { ListEditor } from "./ListEditor";

function documentFixture(): SemanticDocument {
  return {
    workflow_id: "list.fixture",
    version: "1.0.0",
    entry_graph: "main",
    graphs: [{ id: "main", entry_node: "start", nodes: [{ id: "start", kind: "observe", config: {} }, { id: "region", kind: "adaptive_region", config: {} }], edges: [], guards: [] }],
  } as unknown as SemanticDocument;
}

describe("ListEditor", () => {
  it("lists every node, marks protected regions and forwards additive selection", () => {
    const onSelect = vi.fn();
    render(<ListEditor document={documentFixture()} selectedIds={["main:start"]} onSelect={onSelect} inspector={<p>inspector slot</p>} />);
    expect(screen.getByText("entry: start")).toBeInTheDocument();
    expect(screen.getByText("protected")).toBeInTheDocument();
    const row = screen.getByText("start").closest("button") as HTMLButtonElement;
    expect(row).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByText("adaptive_region").closest("button") as HTMLButtonElement, { metaKey: true });
    expect(onSelect).toHaveBeenCalledWith("main:region", true);
    expect(screen.getByText("inspector slot")).toBeInTheDocument();
  });
});
