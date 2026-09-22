import { describe, expect, it } from "vitest";

import { createLayout, qualifiedNodeId } from "@studio/document";
import { fixtureDefinitions } from "../../fixtures/catalog";
import { toFlowEdges, toFlowNodes, type FlowNode } from "./graphProjection";
import { findSelectedNode, locateEdge, minimapNodeColor, nextNodeId, splitQualifiedId } from "./selectionModel";

const document0 = fixtureDefinitions[0].definition;

describe("selection model", () => {
  it("splits qualified ids and rejects malformed ones", () => {
    expect(splitQualifiedId("main:observe")).toEqual({ graphId: "main", nodeId: "observe" });
    expect(splitQualifiedId("observe")).toBeUndefined();
    expect(splitQualifiedId(":observe")).toBeUndefined();
    expect(splitQualifiedId("main:")).toBeUndefined();
  });

  it("allocates the next unused studio node id", () => {
    expect(nextNodeId([])).toBe("studio_node_1");
    expect(nextNodeId(["studio_node_1", "studio_node_2"])).toBe("studio_node_3");
    expect(nextNodeId(["studio_node_2"])).toBe("studio_node_1");
  });

  it("locates a node inside its owning graph", () => {
    expect(findSelectedNode(document0, "main:decide")?.node.id).toBe("decide");
    expect(findSelectedNode(document0, "main:missing")).toBeUndefined();
    expect(findSelectedNode(document0, "missing:decide")).toBeUndefined();
    expect(findSelectedNode(document0, undefined)).toBeUndefined();
  });

  it("locates an edge by its stable id and reports unknowns", () => {
    expect(locateEdge(document0, "main:observe->main:decide:ok:0:")).toEqual({ graphId: "main", edgeIndex: 0 });
    expect(locateEdge(document0, "main:observe->main:decide:error:0:")).toBeUndefined();
  });

  it("colors locked nodes distinctly from editable nodes", () => {
    expect(minimapNodeColor({ data: { locked: true } } as unknown as FlowNode)).toBe("#f0a45b");
    expect(minimapNodeColor({ data: { locked: false } } as unknown as FlowNode)).toBe("#5da8ff");
  });
});

describe("graph projection", () => {
  it("projects edges from the semantic graph with stable ids and data", () => {
    const edges = toFlowEdges(document0);
    const first = edges.find((edge) => edge.id === "main:observe->main:decide:ok:0:");
    expect(first).toBeDefined();
    expect(first?.label).toBe("ok");
    expect(first?.source).toBe(qualifiedNodeId("main", "observe"));
    expect(first?.data).toEqual({ qualifiedSource: qualifiedNodeId("main", "observe"), qualifiedTarget: qualifiedNodeId("main", "decide") });
    expect(edges).toHaveLength(document0.graphs.reduce((total, graph) => total + graph.edges.length, 0));
  });

  it("projects nodes with selection, lock styling and stable identity reuse", () => {
    const layout = createLayout(document0, "pending");
    const nodes = toFlowNodes(document0, layout, ["main:observe"]);
    const selected = nodes.find((node) => node.id === qualifiedNodeId("main", "observe"));
    expect(selected?.selected).toBe(true);
    expect(selected?.draggable).toBe(!selected?.data.locked);
    expect(selected?.selectable).toBe(true);

    const again = toFlowNodes(document0, layout, ["main:observe"], nodes);
    expect(again.find((node) => node.id === qualifiedNodeId("main", "observe"))).toBe(selected);

    const reselected = toFlowNodes(document0, layout, ["main:decide"], nodes);
    const observe = reselected.find((node) => node.id === qualifiedNodeId("main", "observe"));
    expect(observe).not.toBe(selected);
    expect(observe?.selected).toBe(false);
  });
});
