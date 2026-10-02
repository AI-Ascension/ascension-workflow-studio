import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { type ValidateResponse } from "@studio/contracts";
import { DiagnosticsPanel } from "./DiagnosticsPanel";

function result(overrides: Partial<ValidateResponse> = {}): ValidateResponse {
  return {
    valid: false,
    definition_digest: "sha256:0000000000000000abcdef",
    diagnostics: [
      { code: "bind.missing", severity: "error", path: "graphs/main.nodes/x", message: "Missing binding." },
      { code: "layout.hint", severity: "warning", path: "graphs/main.nodes/y", message: "Layout hint." },
    ],
    ...overrides,
  } as unknown as ValidateResponse;
}

describe("DiagnosticsPanel", () => {
  it("routes a diagnostic path to navigation without changing the result", () => {
    const onFocusPath = vi.fn();
    render(<DiagnosticsPanel result={result()} onFocusPath={onFocusPath} onFocusNode={vi.fn()} />);
    expect(screen.getByText("Definition needs attention")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Focus diagnostic graphs/main.nodes/x" }));
    expect(onFocusPath).toHaveBeenCalledWith("graphs/main.nodes/x");
    expect(screen.getByText("error")).toBeInTheDocument();
    expect(screen.getByText("warning")).toBeInTheDocument();
  });

  it("reports an admitted definition with no diagnostics", () => {
    render(<DiagnosticsPanel result={result({ valid: true, diagnostics: [] })} onFocusPath={vi.fn()} onFocusNode={vi.fn()} />);
    expect(screen.getByText("Definition admitted")).toBeInTheDocument();
    expect(screen.getByText("No diagnostics returned by the active adapter.")).toBeInTheDocument();
  });

  const digest = "c".repeat(64);

  it("shows the owner's resolved decision beside the authored reference", () => {
    const onFocusNode = vi.fn();
    render(<DiagnosticsPanel result={result({
      inference_profiles: [{
        graph_id: "campaign",
        node_id: "decide-now",
        node_kind: "decide",
        profile_ref: "sts2.campaign.decision.v1",
        resolved_pin: `sts2.campaign.decision.v1:1.0.0:${digest}`,
        path: "$.graphs[0].nodes[0].config.decision_profile_ref",
      }],
    })} onFocusPath={vi.fn()} onFocusNode={onFocusNode} />);
    // Both are visible: the author's FLOATING reference is shown as authored,
    // and the owner's exact resolution beside it. The reference is not
    // rewritten to the pin anywhere in the presentation.
    expect(screen.getAllByText("sts2.campaign.decision.v1").length).toBeGreaterThan(0);
    expect(screen.getByText(`sts2.campaign.decision.v1:1.0.0:${digest}`)).toBeInTheDocument();
    // The focus control passes the entry's OWN ids, never its index-based path.
    fireEvent.click(screen.getByRole("button", { name: "Focus $.graphs[0].nodes[0].config.decision_profile_ref" }));
    expect(onFocusNode).toHaveBeenCalledWith(expect.objectContaining({ graph_id: "campaign", node_id: "decide-now" }));
  });

  it("says the owner published nothing rather than inventing a resolution", () => {
    const { unmount } = render(
      <DiagnosticsPanel result={result({ inference_profiles: undefined })} onFocusPath={vi.fn()} onFocusNode={vi.fn()} />,
    );
    expect(screen.getByText(/published no inference-profile decision/)).toBeInTheDocument();
    unmount();

    render(<DiagnosticsPanel result={result({ inference_profiles: null })} onFocusPath={vi.fn()} onFocusNode={vi.fn()} />);
    expect(screen.getByText(/serves no inference-profile catalog/)).toBeInTheDocument();
  });

  it("distinguishes an empty resolution from an absent one", () => {
    render(<DiagnosticsPanel result={result({ inference_profiles: [] })} onFocusPath={vi.fn()} onFocusNode={vi.fn()} />);
    expect(screen.getByText(/references no inference profile/)).toBeInTheDocument();
  });
});
