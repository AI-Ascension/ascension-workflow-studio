import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { type WorkflowNode } from "@studio/contracts";
import { type SemanticDocument } from "@studio/document";
import { GraphNavigator, LoopBodyGraphNavigation } from "./GraphNavigator";

function documentFixture(): SemanticDocument {
  return {
    workflow_id: "nav.fixture",
    version: "1.0.0",
    entry_graph: "main",
    graphs: [{ id: "main", nodes: [], edges: [], guards: [] }, { id: "child", nodes: [], edges: [], guards: [] }],
  } as unknown as SemanticDocument;
}

describe("GraphNavigator", () => {
  it("keeps one focused graph, exposes the trail and switches graphs explicitly", () => {
    const onFocus = vi.fn();
    const onSelectTrail = vi.fn();
    render(<GraphNavigator document={documentFixture()} activeGraphId="child" trail={["main", "child"]} onFocus={onFocus} onSelectTrail={onSelectTrail} />);
    const currentCrumb = screen.getAllByText("child").find((element) => element.getAttribute("aria-current") === "page");
    expect(currentCrumb).toBeDefined();
    fireEvent.click(screen.getAllByRole("button", { name: "main" })[0]);
    expect(onSelectTrail).toHaveBeenCalledWith(0);
    fireEvent.click(screen.getByRole("button", { name: "child", pressed: true }));
    expect(onFocus).toHaveBeenCalledWith("child");
    expect(screen.getByText(/not execution ordering or parallelism/)).toBeInTheDocument();
  });
});

describe("LoopBodyGraphNavigation", () => {
  const node = (body: unknown): WorkflowNode => ({ id: "loop1", kind: "loop", config: { body_graph: body } }) as unknown as WorkflowNode;

  it("navigates only into an admitted loop body graph", () => {
    const onNavigateGraph = vi.fn();
    render(<LoopBodyGraphNavigation document={documentFixture()} node={node("child")} onNavigateGraph={onNavigateGraph} />);
    fireEvent.click(screen.getByRole("button", { name: "Open body graph: child" }));
    expect(onNavigateGraph).toHaveBeenCalledWith("child");
  });

  it("renders nothing when the body graph is missing or unadmitted", () => {
    const { container } = render(<LoopBodyGraphNavigation document={documentFixture()} node={node("missing")} onNavigateGraph={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});
