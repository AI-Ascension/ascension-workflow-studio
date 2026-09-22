import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { WorkflowNode } from "@studio/contracts";
import type { SemanticDocument } from "@studio/document";
import { fixtureDefinitions } from "../../fixtures/catalog";
import { InspectorPanel, type SelectedNode } from "./InspectorPanel";

function documentWith(nodes: WorkflowNode[]): SemanticDocument {
  return {
    workflow_id: "inspector.fixture",
    version: "1.0.0",
    mode: "strict",
    game_profile: "sts2",
    policy_ref: "policy.fixture",
    capabilities: { required: [] },
    entry_graph: "root",
    graphs: [{ id: "root", nodes, edges: [], guards: [] }],
  } as unknown as SemanticDocument;
}

function renderInspector(node: WorkflowNode, options: { selectedConfigText?: string } = {}): {
  onUpdate: ReturnType<typeof vi.fn>;
  onRemove: ReturnType<typeof vi.fn>;
  onNavigateGraph: ReturnType<typeof vi.fn>;
} {
  const onUpdate = vi.fn();
  const onRemove = vi.fn();
  const onNavigateGraph = vi.fn();
  const selected: SelectedNode = { graphId: "root", node };
  render(<InspectorPanel
    document={documentWith([node])}
    catalog={fixtureDefinitions}
    contextBindings={[]}
    selected={selected}
    selectedConfigText={options.selectedConfigText ?? JSON.stringify(node.config, null, 2)}
    onUpdate={onUpdate}
    onRemove={onRemove}
    onNavigateGraph={onNavigateGraph}
  />);
  return { onUpdate, onRemove, onNavigateGraph };
}

describe("InspectorPanel typed configuration controls", () => {
  it("renders an undisclosed current context reference as disabled and never offers it as a selectable option", () => {
    const node: WorkflowNode = { id: "analyze1", kind: "analyze", config: { context_ref: "context.secret.v1" } };
    renderInspector(node);
    const select = screen.getByLabelText("analyze1 Analysis context");
    expect(select).toBeDisabled();
    expect(select).toHaveTextContent("context.secret.v1 (current, not disclosed)");
    const current = Array.from((select as HTMLSelectElement).options).find((option) => option.value === "context.secret.v1");
    expect(current).toBeDefined();
    expect(current).toBeDisabled();
    expect(screen.getByText(/did not disclose compatible context references/)).toBeInTheDocument();
  });

  it("only commits kind conversions after the explicit preview confirmation", () => {
    const node: WorkflowNode = { id: "observe1", kind: "observe", config: { projection_ref: "projection.v1" } };
    const { onUpdate } = renderInspector(node);
    fireEvent.change(screen.getByLabelText("Node kind"), { target: { value: "analyze" } });
    expect(onUpdate).not.toHaveBeenCalled();
    const preview = screen.getByRole("region", { name: "Node kind conversion preview" });
    expect(preview).toHaveTextContent("Fields removed:");
    fireEvent.click(screen.getByRole("button", { name: "Apply kind change" }));
    expect(onUpdate).toHaveBeenCalledTimes(1);
    const apply = onUpdate.mock.calls[0][0] as (candidate: WorkflowNode) => WorkflowNode;
    expect(apply(node).kind).toBe("analyze");
    expect(screen.queryByRole("region", { name: "Node kind conversion preview" })).not.toBeInTheDocument();
  });

  it("reports an unresolved pinned subworkflow reference without applying it", () => {
    const node: WorkflowNode = { id: "sub1", kind: "subworkflow", config: { artifact_ref: { id: "missing.workflow", version: "0.0.1", digest: "sha256:missing" } } };
    renderInspector(node);
    const resolution = screen.getByLabelText("Pinned reference resolution");
    expect(resolution).toHaveAttribute("data-status", "unavailable");
    expect(resolution).toHaveTextContent("unavailable");
    expect(screen.getByDisplayValue("missing.workflow")).toBeInTheDocument();
  });
});
