import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { createLayout } from "@studio/document";

import { fixtureDefinitions } from "../../fixtures/catalog";
import { ConflictPanel } from "./ConflictPanel";

const document0 = fixtureDefinitions[0].definition;

function renderPanel(local = document0, remote = document0) {
  const onKeepRemote = vi.fn();
  const onKeepLocal = vi.fn(async () => {});
  const onMerge = vi.fn(async () => {});
  const onCancel = vi.fn();
  render(<ConflictPanel
    base={document0}
    baseLayout={createLayout(document0, "merge")}
    local={local}
    localLayout={createLayout(local, "merge")}
    remote={remote}
    remoteLayout={createLayout(remote, "merge")}
    onKeepRemote={onKeepRemote}
    onKeepLocal={onKeepLocal}
    onMerge={onMerge}
    onCancel={onCancel}
  />);
  return { onKeepRemote, onKeepLocal, onMerge, onCancel };
}

describe("ConflictPanel", () => {
  it("reports a clean merge and dispatches every resolution action", () => {
    const { onKeepRemote, onKeepLocal, onMerge, onCancel } = renderPanel();
    const panel = document.querySelector(".conflict-panel") as HTMLElement;
    expect(panel.querySelector(".status-badge")).toHaveTextContent("mergeable");
    expect(panel).toHaveTextContent("The loaded base, local edits, and owner revision stay visible until an explicit resolution.");

    fireEvent.click(screen.getByRole("button", { name: "Apply non-overlapping merge" }));
    fireEvent.click(screen.getByRole("button", { name: "Save local as new draft" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel resolution" }));
    expect(onMerge).toHaveBeenCalledTimes(1);
    expect(onKeepLocal).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onKeepRemote).not.toHaveBeenCalled();
  });

  it("requires an explicit confirmation before discarding local edits", () => {
    const { onKeepRemote } = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Reload remote…" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Reloading replaces the local candidate with the owner revision and cannot be undone.");
    expect(onKeepRemote).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Keep local edits" }));
    expect(onKeepRemote).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Reload remote…" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard local and reload remote" }));
    expect(onKeepRemote).toHaveBeenCalledTimes(1);
  });

  it("disables the merge action when semantic changes conflict", () => {
    const local = structuredClone(document0);
    local.version = "9.9.9";
    const remote = structuredClone(document0);
    remote.version = "42.0.0";
    renderPanel(local, remote);
    const panel = document.querySelector(".conflict-panel") as HTMLElement;
    expect(panel.querySelector(".status-badge")).toHaveTextContent("conflicts");
    expect(screen.getByRole("button", { name: "Apply non-overlapping merge" })).toBeDisabled();
  });
});
