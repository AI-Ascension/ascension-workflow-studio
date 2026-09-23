import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { createLayout, type SemanticDocument } from "@studio/document";
import { fixtureDefinitions } from "../../fixtures/catalog";
import { ConflictPanel } from "./ConflictPanel";

const base = fixtureDefinitions[0].definition;
const baseLayout = createLayout(base, "pending");

function withVersion(version: string): SemanticDocument {
  const next = structuredClone(base);
  next.version = version;
  return next;
}

function renderPanel(overrides: Partial<Parameters<typeof ConflictPanel>[0]> = {}): void {
  render(<ConflictPanel
    base={base}
    baseLayout={baseLayout}
    local={withVersion("2.0.0")}
    localLayout={baseLayout}
    remote={withVersion("3.0.0")}
    remoteLayout={baseLayout}
    onKeepRemote={vi.fn()}
    onKeepLocal={vi.fn().mockResolvedValue(undefined)}
    onMerge={vi.fn().mockResolvedValue(undefined)}
    onCancel={vi.fn()}
    {...overrides}
  />);
}

describe("ConflictPanel", () => {
  it("reports a clean, mergeable divergence and lets the operator merge", () => {
    const remote = structuredClone(base);
    remote.workflow_id = "sts2.setup.renamed";
    renderPanel({ remote });

    expect(screen.getByRole("heading", { name: "Local and remote drafts diverged" })).toBeInTheDocument();
    expect(screen.getByText("mergeable")).toBeInTheDocument();
    expect(screen.getByText(/Semantic changes merge cleanly/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply non-overlapping merge" })).toBeEnabled();
  });

  it("blocks the merge and flags the count when the same path diverged", () => {
    renderPanel();

    expect(screen.getByText(/\d+ conflicts/)).toBeInTheDocument();
    expect(screen.getByText(/Semantic conflicts require review/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply non-overlapping merge" })).toBeDisabled();
  });

  it("keeps the local layout when both sides moved the same node", () => {
    const localLayout = { ...baseLayout, positions: { ...baseLayout.positions, main: { x: 10, y: 10 } } };
    const remoteLayout = { ...baseLayout, positions: { ...baseLayout.positions, main: { x: 20, y: 20 } } };
    const remote = structuredClone(base);
    remote.workflow_id = "sts2.setup.renamed";
    renderPanel({ local: base, localLayout, remote, remoteLayout });

    expect(screen.getByText(/layout movement also conflicts and local layout is kept/)).toBeInTheDocument();
  });

  it("arms remote reload behind a protected confirmation before discarding local", () => {
    const onKeepRemote = vi.fn();
    renderPanel({ onKeepRemote });

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reload remote…" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Reloading replaces the local candidate with the owner revision and cannot be undone.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Keep local edits" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(onKeepRemote).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Reload remote…" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard local and reload remote" }));
    expect(onKeepRemote).toHaveBeenCalledTimes(1);
  });

  it("routes save-as-new, merge and cancel to the owning controller", () => {
    const onKeepLocal = vi.fn().mockResolvedValue(undefined);
    const onMerge = vi.fn().mockResolvedValue(undefined);
    const onCancel = vi.fn();
    const remote = structuredClone(base);
    remote.workflow_id = "sts2.setup.renamed";
    renderPanel({ remote, onKeepLocal, onMerge, onCancel });

    fireEvent.click(screen.getByRole("button", { name: "Save local as new draft" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply non-overlapping merge" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel resolution" }));

    expect(onKeepLocal).toHaveBeenCalledTimes(1);
    expect(onMerge).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
