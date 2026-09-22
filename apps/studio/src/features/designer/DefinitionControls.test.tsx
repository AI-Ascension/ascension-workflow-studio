import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { SemanticDocument } from "@studio/document";
import { fixtureDefinitions } from "../../fixtures/catalog";
import { DefinitionControls } from "./DefinitionControls";
import { EdgeInspector } from "./EdgeInspector";

function documentFixture(): SemanticDocument {
  return structuredClone(fixtureDefinitions[2].definition) as unknown as SemanticDocument;
}

describe("DefinitionControls bounded fields", () => {
  it("rejects a below-minimum limit without committing and only commits a valid bounded integer", () => {
    const onCommit = vi.fn();
    render(<DefinitionControls document={documentFixture()} onCommit={onCommit} />);
    const input = screen.getByLabelText("Max steps");
    fireEvent.change(input, { target: { value: "0" } });
    fireEvent.blur(input);
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a safe integer ≥ 1.");
    fireEvent.change(input, { target: { value: "5" } });
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect((onCommit.mock.calls[0][0] as SemanticDocument).limits.max_steps).toBe(5);
  });

  it("requires a non-empty owner reference before committing definition text", () => {
    const onCommit = vi.fn();
    render(<DefinitionControls document={documentFixture()} onCommit={onCommit} />);
    const input = screen.getByLabelText("Policy reference");
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.blur(input);
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("This owner reference cannot be empty.");
  });
});

describe("EdgeInspector bounded edge fields", () => {
  it("keeps the apply action disabled for an out-of-range priority", () => {
    const onReconnect = vi.fn();
    const onUpdate = vi.fn();
    render(<EdgeInspector document={documentFixture()} selectedEdge={{ graphId: "main", edgeIndex: 0 }} onReconnect={onReconnect} onUpdate={onUpdate} />);
    const apply = screen.getByRole("button", { name: "Apply edge fields" });
    expect(apply).toBeEnabled();
    fireEvent.change(screen.getByLabelText("Edge priority"), { target: { value: "5000" } });
    expect(apply).toBeDisabled();
    fireEvent.click(apply);
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("drops a cleared optional guard reference on apply", () => {
    const document = documentFixture();
    const graph = document.graphs[0];
    const guardId = (graph.guards ?? [])[0]?.id;
    expect(guardId).toBeDefined();
    graph.edges[0].guard_ref = guardId;
    const onUpdate = vi.fn();
    render(<EdgeInspector document={document} selectedEdge={{ graphId: "main", edgeIndex: 0 }} onReconnect={vi.fn()} onUpdate={onUpdate} />);
    fireEvent.change(screen.getByLabelText("Edge guard reference"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply edge fields" }));
    expect(onUpdate).toHaveBeenCalledTimes(1);
    const next = (onUpdate.mock.calls[0][0] as (edge: SemanticDocument["graphs"][number]["edges"][number]) => SemanticDocument["graphs"][number]["edges"][number])(graph.edges[0]);
    expect(next.guard_ref).toBeUndefined();
  });
});
