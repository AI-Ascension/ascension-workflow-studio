import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { InferenceProfileCatalog, WorkflowNode } from "@studio/contracts";
import { findCredentialBearingProfileFields, resolveInferenceProfile } from "@studio/contracts";
import type { SemanticDocument } from "@studio/document";
import { fixtureDefinitions } from "../../fixtures/catalog";
import { catalogFixture, reseal } from "../../../../../packages/contracts/src/inference-profile-catalog.test-fixtures";
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

function renderInspector(node: WorkflowNode, options: { selectedConfigText?: string; inferenceProfiles?: InferenceProfileCatalog } = {}): {
  onUpdate: ReturnType<typeof vi.fn>;
  onRemove: ReturnType<typeof vi.fn>;
  onNavigateGraph: ReturnType<typeof vi.fn>;
  unmount: () => void;
} {
  const onUpdate = vi.fn();
  const onRemove = vi.fn();
  const onNavigateGraph = vi.fn();
  const selected: SelectedNode = { graphId: "root", node };
  const { unmount } = render(<InspectorPanel
    document={documentWith([node])}
    catalog={fixtureDefinitions}
    contextBindings={[]}
    inferenceProfiles={options.inferenceProfiles}
    selected={selected}
    selectedConfigText={options.selectedConfigText ?? JSON.stringify(node.config, null, 2)}
    onUpdate={onUpdate}
    onRemove={onRemove}
    onNavigateGraph={onNavigateGraph}
  />);
  return { onUpdate, onRemove, onNavigateGraph, unmount };
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

describe("InspectorPanel inference profile selection", () => {
  function pinNode(kind: "decide" | "adaptive_region", config: Record<string, unknown>): WorkflowNode {
    return {
      id: kind === "decide" ? "decide1" : "region1",
      kind,
      config,
    } as WorkflowNode;
  }

  it("writes the exact pin when a designer selects an owner-published decision profile", () => {
    const catalog = catalogFixture();
    const decision = catalog.descriptors.find((d) => d.node_kinds.includes("decide"))!;
    const node = pinNode("decide", {});
    const { onUpdate } = renderInspector(node, { inferenceProfiles: catalog });
    const select = screen.getByLabelText("decide1 Decision profile") as HTMLSelectElement;
    const expectedPin = `${decision.profile_id}:${decision.version}:${decision.digest}`;
    expect(Array.from(select.options).map((o) => o.value)).toContain(expectedPin);
    fireEvent.change(select, { target: { value: expectedPin } });
    expect(onUpdate).toHaveBeenCalledTimes(1);
    const apply = onUpdate.mock.calls[0][0] as (candidate: WorkflowNode) => WorkflowNode;
    expect(apply(node).config.decision_profile_ref).toBe(expectedPin);
  });

  it("resolves decision and planner profiles independently so two nodes hold different valid pins", () => {
    const catalog = catalogFixture();
    const decision = catalog.descriptors.find((d) => d.node_kinds.includes("decide"))!;
    const planner = catalog.descriptors.find((d) => d.node_kinds.includes("adaptive_region"))!;

    const decideNode = pinNode("decide", {});
    const decideResult = renderInspector(decideNode, { inferenceProfiles: catalog });
    const decideSelect = screen.getByLabelText("decide1 Decision profile") as HTMLSelectElement;
    const decidePin = `${decision.profile_id}:${decision.version}:${decision.digest}`;
    fireEvent.change(decideSelect, { target: { value: decidePin } });
    const decideApply = decideResult.onUpdate.mock.calls[0][0] as (c: WorkflowNode) => WorkflowNode;

    decideResult.onUpdate.mockClear();
    decideResult.unmount();

    const plannerNode = pinNode("adaptive_region", {});
    const plannerResult = renderInspector(plannerNode, { inferenceProfiles: catalog });
    const plannerSelect = screen.getByLabelText("region1 Planner profile") as HTMLSelectElement;
    const plannerPin = `${planner.profile_id}:${planner.version}:${planner.digest}`;
    fireEvent.change(plannerSelect, { target: { value: plannerPin } });
    const plannerApply = plannerResult.onUpdate.mock.calls[0][0] as (c: WorkflowNode) => WorkflowNode;

    const decideConfig = decideApply(decideNode).config;
    const plannerConfig = plannerApply(plannerNode).config;
    // The two node kinds resolve independently: each binds its own valid pin,
    // and neither is forced to a single global profile.
    expect(decideConfig.decision_profile_ref).toBe(decidePin);
    expect(plannerConfig.planner_profile_ref).toBe(plannerPin);
    expect(decideConfig.decision_profile_ref).not.toBe(plannerConfig.planner_profile_ref);
    expect(resolveInferenceProfile(catalog, { profile_id: decision.profile_id, version: decision.version, digest: decision.digest }, "decide").ok).toBe(true);
    expect(resolveInferenceProfile(catalog, { profile_id: planner.profile_id, version: planner.version, digest: planner.digest }, "adaptive_region").ok).toBe(true);
  });

  it("refuses an unknown, digest-mismatched, revoked, stale and selection-denied bound profile with its own reason and refuses to write it", () => {
    const catalog = reseal(catalogFixture("negative"));
    const byId = (id: string) => catalog.descriptors.find((d) => d.profile_id === id)!;
    const revoked = byId("revoked.synthetic.v1");
    const cases: { ref: string; reason: string }[] = [
      { ref: `never.published.v9:1.0.0:${"a".repeat(64)}`, reason: "unknown_profile" },
      { ref: `${revoked.profile_id}:${revoked.version}:${"b".repeat(64)}`, reason: "digest_mismatch" },
      { ref: `${revoked.profile_id}:${revoked.version}:${revoked.digest}`, reason: "revoked" },
      { ref: `${byId("stale.synthetic.v1").profile_id}:1.0.0:${byId("stale.synthetic.v1").digest}`, reason: "stale" },
      { ref: `${byId("denied.synthetic.v1").profile_id}:1.0.0:${byId("denied.synthetic.v1").digest}`, reason: "selection_not_granted" },
    ];
    for (const testCase of cases) {
      const node = pinNode("decide", { decision_profile_ref: testCase.ref });
      const view = renderInspector(node, { inferenceProfiles: catalog });
      const refusal = screen.getByLabelText("Decision profile refusal");
      expect(refusal).toHaveAttribute("data-rejection", testCase.reason);
      expect(refusal).toHaveTextContent(testCase.reason);
      // The refused value is rendered but is not a selectable option, and no
      // onUpdate fires from rendering it — it is never silently replaced.
      const select = screen.getByLabelText("decide1 Decision profile") as HTMLSelectElement;
      const currentOption = Array.from(select.options).find((o) => o.value === testCase.ref);
      expect(currentOption?.disabled).toBe(true);
      expect(view.onUpdate).not.toHaveBeenCalled();
      view.unmount();
    }
  });

  it("refuses a context-incompatible bound profile for a node carrying a different context", () => {
    const catalog = reseal(catalogFixture("negative"));
    const other = catalog.descriptors.find((d) => d.profile_id === "otherctx.synthetic.v1")!;
    const node = pinNode("decide", {
      context_ref: "context.synthetic.v1",
      decision_profile_ref: `${other.profile_id}:${other.version}:${other.digest}`,
    });
    renderInspector(node, { inferenceProfiles: catalog });
    const refusal = screen.getByLabelText("Decision profile refusal");
    expect(refusal).toHaveAttribute("data-rejection", "context_incompatible");
  });

  it("offers no selectable profile and shows no fixture data when the owner catalog is unavailable", () => {
    const node = pinNode("decide", {});
    renderInspector(node, { inferenceProfiles: undefined });
    const select = screen.getByLabelText("decide1 Decision profile") as HTMLSelectElement;
    expect(select).toBeDisabled();
    expect(screen.getByText(/owner profile catalog is unavailable/)).toBeInTheDocument();
    // A fixture catalog must not leak in as a runtime fallback.
    const fixture = catalogFixture();
    const fixturePin = `${fixture.descriptors[0].profile_id}:${fixture.descriptors[0].version}:${fixture.descriptors[0].digest}`;
    expect(screen.queryByText(new RegExp(fixturePin))).not.toBeInTheDocument();
  });

  it("reads back a pin whose profile_id contains a colon, the way the owner splits it", () => {
    // The producer's `InferenceProfileRef::parse` uses `rsplitn(3, ':')`, and
    // `RegistryId` accepts `:` inside a `profile_id` (alphanumeric first byte,
    // then alphanumerics and `.`, `_`, `:`, `-`). So `acme:decision.v1` is a
    // legal id and `acme:decision.v1:1.0.0:<digest>` is a legal PIN. A
    // left-to-right `split(":")` that demands exactly three parts rejects that
    // pin, and the field then reports "no selectable binding" for a profile the
    // owner really published. The catalog is resealed so the colon-bearing id
    // is self-consistent and the digest is not what refuses it.
    const catalog = reseal(catalogFixture());
    const target = catalog.descriptors.find((d) => d.node_kinds.includes("decide"))!;
    target.profile_id = "acme:decision.v1";
    const resealed = reseal(catalog);
    const pinned = resealed.descriptors.find((d) => d.node_kinds.includes("decide"))!;
    const pin = `${pinned.profile_id}:${pinned.version}:${pinned.digest}`;
    const node = pinNode("decide", { decision_profile_ref: pin });
    renderInspector(node, { inferenceProfiles: resealed });
    // The bound pin resolves against the owner rather than being dropped.
    expect(screen.queryByLabelText("Decision profile refusal")).not.toBeInTheDocument();
    const resolution = screen.getByLabelText("Decision profile resolution");
    expect(resolution).toHaveAttribute("data-status", "resolved");
    // The current option is enabled, i.e. the owner really published it.
    const select = screen.getByLabelText("decide1 Decision profile") as HTMLSelectElement;
    const current = Array.from(select.options).find((o) => o.value === pin);
    expect(current?.disabled).toBe(false);
    // And it is offered as a selectable option carrying the full colon-bearing id.
    expect(Array.from(select.options).map((o) => o.value)).toContain(pin);
  });

  it("exposes no credential-bearing field on the rendered surface (positive control via the leak guard)", () => {
    const catalog = catalogFixture();
    const node = pinNode("decide", {});
    renderInspector(node, { inferenceProfiles: catalog });
    // Positive control: the guard actually detects a planted leak.
    const planted = catalogFixture();
    (planted.descriptors[0] as unknown as Record<string, unknown>).api_key = "sk-not-real";
    expect(findCredentialBearingProfileFields(planted)).toContain("descriptors[0].api_key");
    // The real catalog, as rendered, has no credential-bearing field.
    expect(findCredentialBearingProfileFields(catalog)).toEqual([]);
    const container = screen.getByLabelText("decide1 Decision profile field");
    for (const forbidden of ["api_key", "apiKey", "token", "secret", "password", "endpoint", "prompt_bytes"]) {
      expect(container.textContent ?? "").not.toContain(forbidden);
    }
  });

  it("keeps the adaptive_region planner field and allowed operations read-only together", () => {
    const catalog = catalogFixture();
    const node: WorkflowNode = {
      id: "region1", kind: "adaptive_region",
      config: { region_id: "r1", planner_profile_ref: "floating-planner-ref", allowed_operations: ["a"] },
    } as WorkflowNode;
    renderInspector(node, { inferenceProfiles: catalog });
    // A floating (unpinned) reference is not a valid pin and must not resolve.
    expect(screen.queryByLabelText("Planner profile refusal")).not.toBeInTheDocument();
    const select = screen.getByLabelText("region1 Planner profile") as HTMLSelectElement;
    const planner = catalog.descriptors.find((d) => d.node_kinds.includes("adaptive_region"))!;
    expect(Array.from(select.options).map((o) => o.value)).toContain(`${planner.profile_id}:${planner.version}:${planner.digest}`);
    // Allowed operations remain bounded to what is published; this surface
    // never renders an operation-widening control derived from a profile.
    const operations = screen.getByRole("group", { name: /Allowed operations/ });
    expect(operations).toBeInTheDocument();
  });
});
