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

  /** Builds a catalog that carries BOTH a profile this node kind may bind and
   * the profile this node is already holding but must not be able to re-select.
   * The refusal tests elsewhere run against a catalog where every decide
   * descriptor is refused, which leaves `options.length === 0` and therefore
   * renders the `<select>` disabled — so no change event can reach `select()`
   * at all and the write-path guard is never exercised. Mixing a healthy
   * descriptor into the negative catalog is what keeps the control enabled, so
   * the guard is the only thing standing between an arbitrary string and
   * `decision_profile_ref` / `planner_profile_ref`. */
  function catalogWithSelectable(kind: "decide" | "adaptive_region"): InferenceProfileCatalog {
    const base = reseal(catalogFixture("negative"));
    // The negative fixture only publishes descriptors for `decide`, so a
    // planner node would refuse them as `unsupported_node_kind` instead of the
    // reason under test. Retarget a revoked and a selection-denied copy at the
    // kind being exercised so each case refuses for its OWN reason.
    for (const [profile_id, state] of [
      ["retracted.synthetic.v1", "revoked"],
      ["ungoable.synthetic.v1", "available"],
    ] as const) {
      const descriptor = structuredClone(base.descriptors.find((d) => d.profile_id === "revoked.synthetic.v1")!);
      descriptor.profile_id = profile_id;
      descriptor.node_kinds = [kind];
      descriptor.state = state;
      // A selection-denied profile must still be `available`: the owner
      // publishes it, it just refuses this browser's permission to bind it.
      // `revoked` would short-circuit to the `revoked` reason instead.
      descriptor.grants = profile_id === "retracted.synthetic.v1"
        ? { select: true, edit: true }
        : { select: false, edit: false };
      base.descriptors.push(descriptor);
    }
    const synthetic = reseal(catalogFixture("synthetic")).descriptors
      .find((d) => d.node_kinds.includes(kind))!;
    // The healthy descriptor stays selectable on a node declaring
    // `context.synthetic.v1`: the decision descriptor admits exactly that
    // context, and the planner descriptor is unconstrained.
    const healthy = structuredClone(synthetic);
    // A twin of the same node kind that the owner publishes but only for a
    // DIFFERENT context, so binding it on a `context.synthetic.v1` node refuses
    // as `context_incompatible` while the control stays enabled.
    const foreignContext = structuredClone(synthetic);
    foreignContext.profile_id = "foreignctx.synthetic.v1";
    foreignContext.context_compatibility = ["context.other.v1"];
    base.descriptors = [...base.descriptors, healthy, foreignContext];
    return reseal(base);
  }

  /** Drives the `<select>`'s onChange with a value the DOM itself would never
   * produce. `fireEvent.change(select, { target: { value } })` cannot do this:
   * jsdom's `HTMLSelectElement.value` setter clamps an unlisted string back to
   * the selected option, so the handler would be handed a DIFFERENT string
   * than the one under test and the assertion would be vacuous. Overriding the
   * value getter for the duration of the dispatch delivers the exact string,
   * which is what a real browser (or a tampered client) would hand the
   * handler. */
  function fireUnlistedChange(select: HTMLSelectElement, unlisted: string): void {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value");
    Object.defineProperty(select, "value", { configurable: true, get: () => unlisted });
    try {
      fireEvent.change(select);
    } finally {
      if (descriptor) Object.defineProperty(select, "value", descriptor);
      else delete (select as unknown as Record<string, unknown>).value;
    }
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

  it("refuses to commit an unlisted pin through the enabled decision and planner selects", () => {
    // The write path, not the render path. Each node below is holding a value
    // the owner refuses, in a catalog that ALSO publishes a healthy profile for
    // that node kind, so the control is enabled and a change event genuinely
    // reaches `select()`. Every case asserts that an arbitrary string — one
    // present neither in the catalog nor in the current binding — is refused
    // rather than written into the document.
    const cases: {
      field: "decision_profile_ref" | "planner_profile_ref";
      kind: "decide" | "adaptive_region";
      label: string;
      fieldLabel: string;
      rejection: string;
      ref: string;
      unlisted: string;
    }[] = [];

    const decideCatalog = catalogWithSelectable("decide");
    const decideById = (id: string) => decideCatalog.descriptors.find((d) => d.profile_id === id)!;
    const revoked = decideById("revoked.synthetic.v1");
    const denied = decideById("denied.synthetic.v1");
    const stale = decideById("stale.synthetic.v1");
    const decideForeign = decideById("foreignctx.synthetic.v1");
    cases.push(
      // Unknown id: the owner never published this profile at all.
      {
        field: "decision_profile_ref", kind: "decide", label: "decide1 Decision profile", fieldLabel: "Decision profile",
        rejection: "unknown_profile",
        ref: "never.published.v9:1.0.0:" + "a".repeat(64),
        unlisted: "also.never.published.v9:1.0.0:" + "c".repeat(64),
      },
      // Revoked, and selection-denied: published, but the owner says no.
      {
        field: "decision_profile_ref", kind: "decide", label: "decide1 Decision profile", fieldLabel: "Decision profile",
        rejection: "revoked",
        ref: `${revoked.profile_id}:${revoked.version}:${revoked.digest}`,
        unlisted: "attacker.supplied.v1:1.0.0:" + "d".repeat(64),
      },
      {
        field: "decision_profile_ref", kind: "decide", label: "decide1 Decision profile", fieldLabel: "Decision profile",
        rejection: "selection_not_granted",
        ref: `${denied.profile_id}:${denied.version}:${denied.digest}`,
        unlisted: "smuggled.v1:2.0.0:" + "e".repeat(64),
      },
      // Wrong digest on a profile that IS otherwise publishable.
      {
        field: "decision_profile_ref", kind: "decide", label: "decide1 Decision profile", fieldLabel: "Decision profile",
        rejection: "digest_mismatch",
        ref: `${revoked.profile_id}:${revoked.version}:${"b".repeat(64)}`,
        unlisted: "digest.laid.v1:1.0.0:" + "f".repeat(64),
      },
      // Stale revision.
      {
        field: "decision_profile_ref", kind: "decide", label: "decide1 Decision profile", fieldLabel: "Decision profile",
        rejection: "stale",
        ref: `${stale.profile_id}:${stale.version}:${stale.digest}`,
        unlisted: "future.revision.v1:9.9.9:" + "1".repeat(64),
      },
      // Context-incompatible: published for this node kind, but not for the
      // context this node carries. The healthy descriptor stays selectable, so
      // the control is enabled here too.
      {
        field: "decision_profile_ref", kind: "decide", label: "decide1 Decision profile", fieldLabel: "Decision profile",
        rejection: "context_incompatible",
        ref: `${decideForeign.profile_id}:${decideForeign.version}:${decideForeign.digest}`,
        unlisted: "wrong.context.v1:1.0.0:" + "2".repeat(64),
      },
    );

    const plannerCatalog = catalogWithSelectable("adaptive_region");
    const plannerById = (id: string) => plannerCatalog.descriptors.find((d) => d.profile_id === id)!;
    const plannerRevoked = plannerById("retracted.synthetic.v1");
    const plannerDenied = plannerById("ungoable.synthetic.v1");
    const plannerForeign = plannerById("foreignctx.synthetic.v1");
    cases.push(
      {
        field: "planner_profile_ref", kind: "adaptive_region", label: "region1 Planner profile", fieldLabel: "Planner profile",
        rejection: "revoked",
        ref: `${plannerRevoked.profile_id}:${plannerRevoked.version}:${plannerRevoked.digest}`,
        unlisted: "planner.smuggle.v1:1.0.0:" + "3".repeat(64),
      },
      {
        field: "planner_profile_ref", kind: "adaptive_region", label: "region1 Planner profile", fieldLabel: "Planner profile",
        rejection: "selection_not_granted",
        ref: `${plannerDenied.profile_id}:${plannerDenied.version}:${plannerDenied.digest}`,
        unlisted: "planner.denied.v1:1.0.0:" + "5".repeat(64),
      },
      {
        field: "planner_profile_ref", kind: "adaptive_region", label: "region1 Planner profile", fieldLabel: "Planner profile",
        rejection: "context_incompatible",
        ref: `${plannerForeign.profile_id}:${plannerForeign.version}:${plannerForeign.digest}`,
        unlisted: "planner.otherctx.v1:1.0.0:" + "4".repeat(64),
      },
    );

    for (const testCase of cases) {
      // Every node declares the one context its healthy descriptor admits, so
      // the control is enabled; the context-incompatible case needs that
      // declaration in order to refuse for context rather than for want of one.
      const contextRef = "context.synthetic.v1";
      const node = pinNode(testCase.kind, {
        context_ref: contextRef,
        [testCase.field]: testCase.ref,
      });
      const catalog = testCase.kind === "decide" ? decideCatalog : plannerCatalog;
      const view = renderInspector(node, { inferenceProfiles: catalog });

      // Precondition: the value under test really is rendered as refused, and
      // the control really is enabled — otherwise this case would pass for the
      // wrong reason (a disabled control refuses everything).
      const select = screen.getByLabelText(testCase.label) as HTMLSelectElement;
      expect(select).toBeEnabled();
      const refusal = screen.getByLabelText(`${testCase.fieldLabel} refusal`);
      expect(refusal).toHaveAttribute("data-status", "refused");
      expect(refusal).toHaveAttribute("data-rejection", testCase.rejection);
      expect(Array.from(select.options).map((option) => option.value)).not.toContain(testCase.unlisted);

      // The write path. A value in neither the catalog nor the binding.
      fireUnlistedChange(select, testCase.unlisted);
      expect(view.onUpdate).not.toHaveBeenCalled();
      view.unmount();
    }

    // Positive control on the same harness: the healthy pin IS writable, so
    // "not called" above cannot be an artifact of a control that never commits
    // anything.
    const healthyDecide = decideById("decision.synthetic.v1");
    const decidePin = `${healthyDecide.profile_id}:${healthyDecide.version}:${healthyDecide.digest}`;
    const controlNode = pinNode("decide", {
      context_ref: "context.synthetic.v1",
      decision_profile_ref: `never.published.v9:1.0.0:${"a".repeat(64)}`,
    });
    const control = renderInspector(controlNode, { inferenceProfiles: decideCatalog });
    const controlSelect = screen.getByLabelText("decide1 Decision profile") as HTMLSelectElement;
    expect(Array.from(controlSelect.options).map((option) => option.value)).toContain(decidePin);
    fireEvent.change(controlSelect, { target: { value: decidePin } });
    expect(control.onUpdate).toHaveBeenCalledTimes(1);
    const apply = control.onUpdate.mock.calls[0][0] as (candidate: WorkflowNode) => WorkflowNode;
    expect(apply(controlNode).config.decision_profile_ref).toBe(decidePin);
    control.unmount();
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
