import { describe, expect, it } from "vitest";

import { type WorkflowDefinition } from "@studio/contracts";

import campaign from "../../../../../contracts/accepted/phase1/workflows/campaign.strict.json";
import { focusTargetFromDiagnosticPath, focusTargetFromProfileEntry } from "./diagnosticsFocus";

/** Contract arithmetic on paths a real owner emits, proved against the real
 * accepted fixture. No producer code ran and no owner was contacted: these
 * strings are transcribed from the path formats the owner composes
 * (`inference_profile_binding.rs:188` and `management/validation.rs:120`). */
const document = campaign as unknown as WorkflowDefinition;

describe("owner profile-entry focus", () => {
  it("resolves a real index-based owner path through the entry's own ids", () => {
    // A genuine owner entry from the campaign fixture: `campaign.iteration` is
    // graph 1 and `iteration_decide` is node 1 within it, so the owner path is
    // index-based and contains no id to substring-match.
    const target = focusTargetFromProfileEntry(document, {
      graph_id: "campaign.iteration",
      node_id: "iteration_decide",
    });
    expect(target).toEqual({
      graphId: "campaign.iteration",
      nodeId: "iteration_decide",
      qualifiedId: "campaign.iteration:iteration_decide",
    });
  });

  it("resolves every profile-bearing node of the accepted fixtures by id", () => {
    const cases = [
      ["campaign.iteration", "iteration_decide"],
      ["campaign.iteration", "iteration_execute"],
      ["main", "observe"],
    ] as const;
    for (const [graph_id, node_id] of cases) {
      expect(focusTargetFromProfileEntry(document, { graph_id, node_id })?.qualifiedId)
        .toBe(`${graph_id}:${node_id}`);
    }
  });

  it("fails closed on an entry that names no node in this document", () => {
    expect(focusTargetFromProfileEntry(document, { graph_id: "campaign.iteration", node_id: "absent" })).toBeUndefined();
    expect(focusTargetFromProfileEntry(document, { graph_id: "absent", node_id: "iteration_decide" })).toBeUndefined();
  });

  it("does not fall back to the index-based path when the entry's ids miss", () => {
    // The path addresses a real position, so a path-based resolver would happily
    // select `iteration_observe` here. The ids are authoritative, so this must
    // select nothing rather than a node the owner never named.
    expect(focusTargetFromProfileEntry(document, {
      graph_id: "campaign.iteration",
      node_id: "absent",
    })).toBeUndefined();
  });
});

describe("ordinary diagnostic focus", () => {
  it("still resolves the owner's id-based diagnostic paths", () => {
    // `management/validation.rs:120` composes `$.graphs.{graph_id}.nodes.{node_id}`.
    expect(focusTargetFromDiagnosticPath(document, "$.graphs.campaign.iteration.nodes.iteration_decide"))
      .toEqual({
        graphId: "campaign.iteration",
        nodeId: "iteration_decide",
        qualifiedId: "campaign.iteration:iteration_decide",
      });
    expect(focusTargetFromDiagnosticPath(document, "$.graphs.main.nodes.route_stage")?.qualifiedId)
      .toBe("main:route_stage");
  });

  it("fails closed rather than substring-matching an unrelated node", () => {
    // `iteration_decide` is a real node id, but the path names `iteration_done`.
    // A substring match would select `iteration_decide`; an exact split must not.
    expect(focusTargetFromDiagnosticPath(document, "$.graphs.campaign.iteration.nodes.iteration_done")?.nodeId)
      .toBe("iteration_done");
    expect(focusTargetFromDiagnosticPath(document, "$.graphs.campaign.iteration.nodes.iteration_dec"))
      .toBeUndefined();
  });

  it("does not treat an index-based owner path as an id-based diagnostic path", () => {
    expect(focusTargetFromDiagnosticPath(document, "$.graphs[1].nodes[1].config.decision_profile_ref"))
      .toBeUndefined();
  });

  it("fails closed on a path naming a node this document lacks", () => {
    expect(focusTargetFromDiagnosticPath(document, "$.graphs.main.nodes.absent")).toBeUndefined();
    expect(focusTargetFromDiagnosticPath(document, "$.graphs.absent.nodes.observe")).toBeUndefined();
  });
});
