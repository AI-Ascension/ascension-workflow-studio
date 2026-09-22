import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { buildRecoveryRecord, createLayout } from "@studio/document";
import { fixtureDefinitions } from "../../fixtures/catalog";
import { ArchivalImportPanel } from "./ArchivalImportPanel";
import { BundleImportPreview, BundlePreviewDetails } from "./BundleImportPreview";
import { RawDefinitionPanel } from "./RawDefinitionPanel";
import { RecoveryPanel } from "./RecoveryPanel";

const document0 = fixtureDefinitions[0].definition;

describe("raw definition panel", () => {
  it("reports edits, dispatches apply and surfaces rejection errors", () => {
    const onChange = vi.fn();
    const onApply = vi.fn();
    const { rerender } = render(<RawDefinitionPanel rawText={"{}"} error={undefined} onChange={onChange} onApply={onApply} />);
    const area = screen.getByRole("textbox", { name: "Raw workflow definition JSON" });
    expect(area).toHaveValue("{}");
    fireEvent.change(area, { target: { value: '{"a":1}' } });
    expect(onChange).toHaveBeenCalledWith('{"a":1}');
    fireEvent.click(screen.getByRole("button", { name: "Apply candidate" }));
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    rerender(<RawDefinitionPanel rawText={"{}"} error={"Duplicate keys are rejected."} onChange={onChange} onApply={onApply} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Duplicate keys are rejected.");
  });
});

describe("archival import panel", () => {
  it("retains the original import text read-only with its reason", () => {
    const raw = '{"schema_version":"ascension.workflow/v2","graphs":[]}';
    render(<ArchivalImportPanel archival={{ schemaVersion: "ascension.workflow/v2", rawText: raw, reason: "unsupported schema" }} />);
    expect(screen.getByRole("region", { name: "Read-only archival import" })).toHaveTextContent("unsupported schema");
    const area = screen.getByRole("textbox", { name: "Archived unsupported workflow definition JSON" });
    expect(area).toHaveValue(raw);
    expect(area).toHaveAttribute("readonly");
  });
});

describe("bundle import preview", () => {
  it("summarizes the digest-bound bundle and dispatches apply or cancel", () => {
    const onApply = vi.fn();
    const onCancel = vi.fn();
    const { rerender } = render(<BundleImportPreview value={{ semantic: document0, layout: createLayout(document0, "digest"), digest: "sha256:abc", changedPaths: ["/graphs/0/version", "/graphs/1"], capabilities: ["runs.inspect"] }} onApply={onApply} onCancel={onCancel} />);
    const preview = screen.getByRole("region", { name: "Imported bundle preview" });
    expect(preview).toHaveTextContent("sha256:abc");
    expect(preview).toHaveTextContent("runs.inspect");
    expect(preview).toHaveTextContent("/graphs/0/version");
    fireEvent.click(screen.getByRole("button", { name: "Apply imported bundle" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel import" }));
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
    rerender(<BundleImportPreview value={{ semantic: document0, layout: createLayout(document0, "digest"), digest: "sha256:def", changedPaths: [], capabilities: [] }} onApply={onApply} onCancel={onCancel} />);
    expect(screen.getByText("No semantic differences from the current document.")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Imported bundle preview" })).toHaveTextContent("none");
  });

  it("renders the last portable bundle preview text", () => {
    const { container } = render(<BundlePreviewDetails preview={'{"a":1}'} />);
    expect(screen.getByText("Last portable bundle preview")).toBeInTheDocument();
    expect(container.querySelector(".bundle-preview pre")).toHaveTextContent('{"a":1}');
  });
});

describe("recovery panel", () => {
  it("reflects the enabled state and gates actions on recoverable records", () => {
    const onToggle = vi.fn();
    const { rerender } = render(<RecoveryPanel enabled={false} principal="owner@example.com" count={0} recoverable={undefined} notice="" onToggle={onToggle} onRecover={vi.fn()} onExport={vi.fn()} onClear={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Enable recovery" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Recover unsaved candidate" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Export recovery" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Clear local recovery" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Enable recovery" }));
    expect(onToggle).toHaveBeenCalledTimes(1);

    const recoverable = buildRecoveryRecord({ principal: "owner@example.com", workspace: "studio", definitionId: "wf.fixture", draftId: "draft.wf.fixture", document: document0, layout: createLayout(document0, "digest"), rawText: "{}" });
    rerender(<RecoveryPanel enabled principal="owner@example.com" count={2} recoverable={recoverable} notice="Local recovery records cleared." onToggle={onToggle} onRecover={vi.fn()} onExport={vi.fn()} onClear={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Disable recovery" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Recover unsaved candidate" })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "Export recovery" })).not.toBeDisabled();
    expect(screen.getByRole("region", { name: "Local crash recovery" })).toHaveTextContent("recoverable from");
    expect(screen.getByRole("status")).toHaveTextContent("Local recovery records cleared.");
  });
});
