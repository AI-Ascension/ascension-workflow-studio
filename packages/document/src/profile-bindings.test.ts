import { describe, expect, it } from "vitest";

import {
  catalogFixture,
  reseal,
} from "../../contracts/src/inference-profile-catalog.test-fixtures";
import {
  formatInferenceProfilePin,
  type InferenceProfileCatalog,
  type WorkflowNode,
} from "@studio/contracts";

import { validateProfileBindings } from "./profile-bindings";
import type { SemanticDocument } from "./semantic-document";

function pinOf(catalog: InferenceProfileCatalog, profile_id: string): string {
  const descriptor = catalog.descriptors.find((d) => d.profile_id === profile_id)!;
  return formatInferenceProfilePin({ profile_id: descriptor.profile_id, version: descriptor.version, digest: descriptor.digest });
}

function documentWith(nodes: WorkflowNode[]): SemanticDocument {
  return {
    schema_version: "ascension.workflow/v1",
    workflow_id: "profile.bindings.test",
    version: "1.0.0",
    mode: "strict",
    game_profile: "test",
    policy_ref: "test.policy",
    capabilities: { required: [] },
    entry_graph: "main",
    graphs: [{ id: "main", entry_node: "decide1", nodes, edges: [] }],
    annotations: {},
  } as unknown as SemanticDocument;
}

const decisionPin = (catalog: InferenceProfileCatalog): string => pinOf(catalog, "decision.synthetic.v1");
const plannerPin = (catalog: InferenceProfileCatalog): string => pinOf(catalog, "planner.synthetic.v1");

describe("validateProfileBindings (#112 T2 immutable adoption at admission)", () => {
  it("admits a decide node bound to the owner's exact decision pin", () => {
    const catalog = catalogFixture("synthetic");
    const node: WorkflowNode = { id: "decide1", kind: "decide", config: { decision_profile_ref: decisionPin(catalog), context_ref: "context.synthetic.v1" } };
    expect(validateProfileBindings(documentWith([node]), catalog)).toEqual([]);
  });

  it("admits an adaptive_region bound to the owner's exact planner pin", () => {
    const catalog = catalogFixture("synthetic");
    const node: WorkflowNode = {
      id: "region1",
      kind: "adaptive_region",
      config: { planner_profile_ref: plannerPin(catalog), region_id: "region" },
    };
    expect(validateProfileBindings(documentWith([node]), catalog)).toEqual([]);
  });

  it("admits two nodes of different kinds bound to two different valid pins", () => {
    const catalog = catalogFixture("synthetic");
    const nodes: WorkflowNode[] = [
      { id: "decide1", kind: "decide", config: { decision_profile_ref: decisionPin(catalog), context_ref: "context.synthetic.v1" } },
      { id: "region1", kind: "adaptive_region", config: { planner_profile_ref: plannerPin(catalog), region_id: "region" } },
    ];
    expect(validateProfileBindings(documentWith(nodes), catalog)).toEqual([]);
  });

  // --- The immutability property -------------------------------------------------

  it("refuses a pin whose digest no longer matches the published descriptor after the profile is revised", () => {
    const catalog = catalogFixture("synthetic");
    const before = decisionPin(catalog);
    expect(validateProfileBindings(documentWith([{ id: "decide1", kind: "decide", config: { decision_profile_ref: before } }]), catalog)).toEqual([]);

    // The owner publishes a NEW REVISION of the same profile. The already
    // bound pin names a revision the catalog no longer serves.
    const revised = structuredClone(catalog);
    const descriptor = revised.descriptors.find((d) => d.profile_id === "decision.synthetic.v1")!;
    descriptor.version = "2.0.0";
    reseal(revised);
    const after = revised.descriptors.find((d) => d.profile_id === "decision.synthetic.v1")!;
    expect(formatInferenceProfilePin({ profile_id: after.profile_id, version: after.version, digest: after.digest })).not.toBe(before);

    const issues = validateProfileBindings(documentWith([{ id: "decide1", kind: "decide", config: { decision_profile_ref: before } }]), revised);
    expect(issues).toHaveLength(1);
    // The pin names `1.0.0`; the owner no longer publishes that revision at
    // all, so the honest refusal is that this exact revision is unknown — and
    // in particular the check did NOT quietly advance the binding to 2.0.0.
    expect(issues[0].code).toBe("profile_unknown_profile");
    // The refusal names the pin verbatim and never proposes a replacement:
    // re-adoption is an explicit act, not an automatic upgrade.
    expect(issues[0].message).toContain(before);
    expect(issues[0].message).not.toContain("2.0.0");
  });

  it("refuses a pin whose digest drifted while the revision itself is still published", () => {
    const catalog = catalogFixture("synthetic");
    const descriptor = catalog.descriptors.find((d) => d.profile_id === "decision.synthetic.v1")!;
    // A definition bound to a digest the owner does not publish for THIS
    // revision. The producer re-seals a descriptor whenever its content
    // changes, so this is the shape a tampered or stale pin takes.
    const stalePin = formatInferenceProfilePin({
      profile_id: descriptor.profile_id,
      version: descriptor.version,
      digest: "b".repeat(64),
    });
    const issues = validateProfileBindings(documentWith([{ id: "decide1", kind: "decide", config: { decision_profile_ref: stalePin } }]), catalog);
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe("profile_digest_mismatch");
    expect(issues[0].message).toContain(stalePin);
  });

  it("refuses a floating id rather than resolving it to whatever revision exists now", () => {
    const catalog = catalogFixture("synthetic");
    const issues = validateProfileBindings(documentWith([{ id: "decide1", kind: "decide", config: { decision_profile_ref: "decision.synthetic.v1" } }]), catalog);
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe("profile_pin_malformed");
  });

  it("refuses the floating id that defaultNodeConfig writes for a brand new node", () => {
    const catalog = catalogFixture("synthetic");
    // `defaultNodeConfig` seeds `decide`/`adaptive_region` with a bare
    // placeholder, so a freshly added node must be reported as unbound rather
    // than admitted on the strength of a name the owner never published.
    const issues = validateProfileBindings(documentWith([
      { id: "decide1", kind: "decide", config: { decision_profile_ref: "studio.decision", context_ref: "studio.context" } },
    ]), catalog);
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe("profile_pin_malformed");
  });

  it("refuses an empty or absent profile reference", () => {
    const catalog = catalogFixture("synthetic");
    const empty = validateProfileBindings(documentWith([{ id: "decide1", kind: "decide", config: {} }]), catalog);
    expect(empty.map((issue) => issue.code)).toEqual(["profile_ref_unbound"]);
    const absent = validateProfileBindings(documentWith([{ id: "region1", kind: "adaptive_region", config: {} }]), catalog);
    expect(absent.map((issue) => issue.code)).toEqual(["profile_ref_unbound"]);
  });

  // --- Fails closed --------------------------------------------------------------

  it("fails closed when no owner catalog was received", () => {
    const catalog = catalogFixture("synthetic");
    const issues = validateProfileBindings(documentWith([{ id: "decide1", kind: "decide", config: { decision_profile_ref: decisionPin(catalog) } }]), undefined);
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe("profile_catalog_unavailable");
  });

  it("refuses a tampered catalog rather than trusting it", () => {
    const catalog = structuredClone(catalogFixture("synthetic"));
    // Break the catalog's own digest so admission cannot succeed on an
    // untrusted response.
    catalog.catalog_digest = "f".repeat(64);
    const issues = validateProfileBindings(documentWith([{ id: "decide1", kind: "decide", config: { decision_profile_ref: `decision.synthetic.v1:1.0.0:${"a".repeat(64)}` } }]), catalog);
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe("profile_catalog_untrusted");
  });

  // --- Every owner refusal is preserved -----------------------------------------

  it("preserves each owner refusal reason at admission, including the two the resolver adds", () => {
    const catalog = reseal(catalogFixture("negative"));
    const byId = (id: string) => catalog.descriptors.find((d) => d.profile_id === id)!;
    const revoked = byId("revoked.synthetic.v1");
    const cases: { ref: string; code: string }[] = [
      { ref: `never.published.v9:1.0.0:${"a".repeat(64)}`, code: "profile_unknown_profile" },
      { ref: `${revoked.profile_id}:${revoked.version}:${"b".repeat(64)}`, code: "profile_digest_mismatch" },
      { ref: `${revoked.profile_id}:${revoked.version}:${revoked.digest}`, code: "profile_revoked" },
      { ref: formatInferenceProfilePin(byId("disabled.synthetic.v1")), code: "profile_disabled" },
      { ref: formatInferenceProfilePin(byId("stale.synthetic.v1")), code: "profile_stale" },
      { ref: formatInferenceProfilePin(byId("unsupported.synthetic.v1")), code: "profile_unsupported" },
      { ref: formatInferenceProfilePin(byId("denied.synthetic.v1")), code: "profile_selection_not_granted" },
    ];
    for (const testCase of cases) {
      const issues = validateProfileBindings(documentWith([{ id: "decide1", kind: "decide", config: { decision_profile_ref: testCase.ref } }]), catalog);
      expect(issues.map((issue) => issue.code), testCase.ref).toEqual([testCase.code]);
    }
  });

  it("refuses a pin bound to the wrong node kind", () => {
    const catalog = catalogFixture("synthetic");
    // A planner pin on a `decide` node is exact and currently published, but
    // the owner does not serve it for this node kind.
    const issues = validateProfileBindings(documentWith([{ id: "decide1", kind: "decide", config: { decision_profile_ref: plannerPin(catalog) } }]), catalog);
    expect(issues.map((issue) => issue.code)).toEqual(["profile_unsupported_node_kind"]);
  });

  it("refuses a context-incompatible pin, mirroring the designer field's own judgement", () => {
    const catalog = reseal(catalogFixture("negative"));
    const other = catalog.descriptors.find((d) => d.profile_id === "otherctx.synthetic.v1")!;
    expect(other.context_compatibility.length).toBeGreaterThan(0);
    const ref = formatInferenceProfilePin(other);
    const issues = validateProfileBindings(documentWith([{ id: "decide1", kind: "decide", config: { decision_profile_ref: ref, context_ref: "context.not.admitted.v1" } }]), catalog);
    expect(issues.map((issue) => issue.code)).toEqual(["profile_context_incompatible"]);
  });

  // --- Reporting shape -----------------------------------------------------------

  it("reports every offending node with a path a designer can focus", () => {
    const catalog = catalogFixture("synthetic");
    const nodes: WorkflowNode[] = [
      { id: "decide1", kind: "decide", config: { decision_profile_ref: "floating.id" } },
      { id: "ok", kind: "decide", config: { decision_profile_ref: decisionPin(catalog) } },
      { id: "region1", kind: "adaptive_region", config: { planner_profile_ref: `${plannerPin(catalog)} ` } },
    ];
    const issues = validateProfileBindings(documentWith(nodes), catalog);
    expect(issues).toHaveLength(2);
    expect(issues.map((issue) => [issue.graphId, issue.nodeId])).toEqual([["main", "decide1"], ["main", "region1"]]);
    expect(issues[0].path).toBe("$.graphs.main.nodes.decide1.config.decision_profile_ref");
    expect(issues[1].path).toBe("$.graphs.main.nodes.region1.config.planner_profile_ref");
  });

  it("ignores node kinds that carry no inference profile reference", () => {
    const catalog = catalogFixture("synthetic");
    const nodes: WorkflowNode[] = [
      { id: "start", kind: "observe", config: { projection_ref: "p" } },
      { id: "pause1", kind: "pause", config: { reason_code: "why" } },
      { id: "artifact", kind: "emit_artifact", config: { artifact_kind_ref: "a" } },
    ];
    expect(validateProfileBindings(documentWith(nodes), catalog)).toEqual([]);
    // Even with no catalog at all, kinds that bind no profile stay clean.
    expect(validateProfileBindings(documentWith(nodes), undefined)).toEqual([]);
  });

  it("parses a profile_id containing colons the producer's rsplitn would keep", () => {
    const catalog = reseal(catalogFixture("synthetic"));
    const descriptor = catalog.descriptors.find((d) => d.profile_id === "decision.synthetic.v1")!;
    descriptor.profile_id = "studio:decision:v1";
    reseal(catalog);
    const updated = catalog.descriptors.find((d) => d.profile_id === "studio:decision:v1")!;
    const ref = formatInferenceProfilePin(updated);
    expect(validateProfileBindings(documentWith([{ id: "decide1", kind: "decide", config: { decision_profile_ref: ref } }]), catalog)).toEqual([]);
  });
});
