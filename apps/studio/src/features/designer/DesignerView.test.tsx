import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FixtureClient } from "@studio/client";
import { fixtureDefinitions } from "../../fixtures/catalog";
import { DesignerView } from "./DesignerView";
import { IndexedDbRecoveryStore } from "./recoveryStore";

async function openDesigner(): Promise<FixtureClient> {
  const client = new FixtureClient(fixtureDefinitions);
  const definition = fixtureDefinitions[0];
  render(<DesignerView client={client} catalog={fixtureDefinitions} definition={definition}
    initialDocument={definition.definition} mode="fixture" onBack={vi.fn()}
    onRun={vi.fn()} onRawTextChange={vi.fn()} />);
  await act(async () => {});
  fireEvent.click(screen.getByRole("button", { name: "JSON mode" }));
  return client;
}

function applyRaw(raw: string): void {
  fireEvent.change(screen.getByRole("textbox", { name: "Raw workflow definition JSON" }), { target: { value: raw } });
  fireEvent.click(screen.getByRole("button", { name: "Apply candidate" }));
}

describe("unsupported definition isolation", () => {
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it.each(["future schema", "future node"])("suspends writes and shortcuts for a %s until returning to the draft", async (kind) => {
    vi.useFakeTimers();
    const client = await openDesigner();
    const save = vi.spyOn(client, "saveDraft");
    const recover = vi.spyOn(IndexedDbRecoveryStore.prototype, "put").mockResolvedValue({ prunedForQuota: false });
    fireEvent.click(screen.getByRole("button", { name: "Enable recovery" }));
    const edited = structuredClone(fixtureDefinitions[0].definition);
    edited.version = "9.0.0";
    applyRaw(JSON.stringify(edited));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    const unsupported = structuredClone(edited);
    if (kind === "future node") unsupported.graphs[0].nodes[0].kind = "future_owner_kind";
    const original = kind === "future schema"
      ? '{\n  "schema_version": "ascension.workflow/v2", "graphs": []\n}\n'
      : `${JSON.stringify(unsupported, null, 4)}\n`;
    applyRaw(original);
    const archive = screen.getByRole("textbox", { name: "Archived unsupported workflow definition JSON" });
    expect(archive).toHaveValue(original);
    expect(archive).toHaveAttribute("readonly");
    for (const name of ["Publish revision", "Run inspection", "Retry save", "Apply candidate", "＋ Node", "Undo", "Export"]) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    fireEvent.keyDown(window, { key: "v", metaKey: true });
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(save).not.toHaveBeenCalled();
    expect(recover).not.toHaveBeenCalled();
    expect(archive).toHaveValue(original);
    fireEvent.click(screen.getByRole("button", { name: "Return to previous draft" }));
    expect(JSON.parse((screen.getByRole("textbox", { name: "Raw workflow definition JSON" }) as HTMLTextAreaElement).value)).toEqual(edited);
    await act(async () => { await vi.advanceTimersByTimeAsync(800); });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0].document).toEqual(edited);
    expect(recover).toHaveBeenCalledTimes(1);
  });

  it("does not publish after pending owner validation resolves in archive mode", async () => {
    vi.useFakeTimers();
    const client = await openDesigner();
    await act(async () => { await vi.advanceTimersByTimeAsync(800); });
    const result = await client.validate(fixtureDefinitions[0].definition);
    let finishValidation!: (value: typeof result) => void;
    vi.spyOn(client, "validate").mockImplementation(() => new Promise((resolve) => { finishValidation = resolve; }));
    const publish = vi.spyOn(client, "publishDraft");
    fireEvent.click(screen.getByRole("button", { name: "Publish revision" }));
    applyRaw('{"schema_version":"ascension.workflow/v2","graphs":[]}');
    await act(async () => { finishValidation(result); });
    expect(publish).not.toHaveBeenCalled();
    expect(screen.getByRole("region", { name: "Read-only archival import" })).toBeInTheDocument();
  });
});
