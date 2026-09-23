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
    render(<DiagnosticsPanel result={result()} onFocusPath={onFocusPath} />);
    expect(screen.getByText("Definition needs attention")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Focus diagnostic graphs/main.nodes/x" }));
    expect(onFocusPath).toHaveBeenCalledWith("graphs/main.nodes/x");
    expect(screen.getByText("error")).toBeInTheDocument();
    expect(screen.getByText("warning")).toBeInTheDocument();
  });

  it("reports an admitted definition with no diagnostics", () => {
    render(<DiagnosticsPanel result={result({ valid: true, diagnostics: [] })} onFocusPath={vi.fn()} />);
    expect(screen.getByText("Definition admitted")).toBeInTheDocument();
    expect(screen.getByText("No diagnostics returned by the active adapter.")).toBeInTheDocument();
  });
});
