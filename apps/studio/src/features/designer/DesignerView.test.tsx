import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FixtureClient } from "@studio/client";
import { fixtureDefinitions } from "../../fixtures/catalog";
import { DesignerView } from "./DesignerView";
import { IndexedDbRecoveryStore } from "./recoveryStore";
import { catalogFixture } from "../../../../../packages/contracts/src/context-owner-catalog.test-fixtures";

/**
 * The autosave debounce in `useDraftPersistence`. Advancing the fake clock past
 * this is what proves a save fired; advancing to an arbitrary 2000ms spent most
 * of the 5s budget proving nothing extra (studio#222).
 */
const AUTOSAVE_DEBOUNCE_MS = 700;

async function openDesigner(): Promise<FixtureClient> {
  const client = new FixtureClient(fixtureDefinitions);
  const definition = fixtureDefinitions[0];
  render(<DesignerView client={client} catalog={fixtureDefinitions} definition={definition}
    initialDocument={definition.definition} mode="fixture" onBack={vi.fn()}
    onRun={vi.fn()} onRawTextChange={vi.fn()} />);
  // Synchronise on the control this helper actually depends on. A bare
  // `await act(async () => {})` flushes whatever has happened to be scheduled,
  // so whether the editor is mounted depended on unrelated scheduling and the
  // render cost, not on the settled condition (studio#222).
  fireEvent.click(await screen.findByRole("button", { name: "JSON mode" }));
  return client;
}

function applyRaw(raw: string): void {
  fireEvent.change(screen.getByRole("textbox", { name: "Raw workflow definition JSON" }), { target: { value: raw } });
  fireEvent.click(screen.getByRole("button", { name: "Apply candidate" }));
}

describe("unsupported definition isolation", () => {
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it.each(["future schema", "future node"])("suspends writes and shortcuts for a %s until returning to the draft", async (kind) => {
    const client = await openDesigner();
    vi.useFakeTimers();
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
    // One pass instead of seven full-DOM rescans: each `queryByRole` call
    // re-walks every element, which is what pushed this test past the budget
    // under `--maxWorkers=1` (studio#222).
    //
    // `button.textContent` is the accessible name for these plain-text
    // controls, so this asserts the same thing the seven individual role
    // queries did. It would silently weaken if one of them ever gained an
    // `aria-label` or `title` that overrides its contents, so the names are
    // also asserted to match their contents.
    const buttons = screen.queryAllByRole("button");
    const available = new Set(buttons.map((button) => (
      button.getAttribute("aria-label") ?? button.getAttribute("title") ?? button.textContent?.trim()
    )));
    for (const button of buttons) {
      expect(
        button.getAttribute("aria-label") ?? button.getAttribute("title") ?? button.textContent?.trim(),
      ).toBe(button.textContent?.trim());
    }
    for (const name of ["Publish revision", "Run inspection", "Retry save", "Apply candidate", "＋ Node", "Undo", "Export"]) {
      expect(available.has(name)).toBe(false);
    }
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    fireEvent.keyDown(window, { key: "v", metaKey: true });
    // Past the debounce, so a save *would* have fired if the archive had not
    // suspended it.
    await act(async () => { await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS + 1); });
    expect(save).not.toHaveBeenCalled();
    expect(recover).not.toHaveBeenCalled();
    expect(archive).toHaveValue(original);
    fireEvent.click(screen.getByRole("button", { name: "Return to previous draft" }));
    expect(JSON.parse((screen.getByRole("textbox", { name: "Raw workflow definition JSON" }) as HTMLTextAreaElement).value)).toEqual(edited);
    await act(async () => { await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS + 1); });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0].document).toEqual(edited);
    expect(recover).toHaveBeenCalledTimes(1);
  });

  it("does not publish after pending owner validation resolves in archive mode", async () => {
    const client = await openDesigner();
    vi.useFakeTimers();
    // #112 T2: publication only reaches the owner once every profile-bearing
    // node is bound to an identity the owner publishes. Bind this fixture's
    // decide node to the catalog's exact pin so the test exercises the race it
    // is named for (a stale in-flight validation) rather than being short
    // circuited by profile admission.
    const bound = structuredClone(fixtureDefinitions[0].definition);
    const decision = bound.graphs[0].nodes.find((node) => node.kind === "decide")!;
    const descriptor = (await client.listInferenceProfiles()).descriptors.find((d) => d.profile_id === "decision.synthetic.v1")!;
    decision.config = {
      ...decision.config,
      decision_profile_ref: `${descriptor.profile_id}:${descriptor.version}:${descriptor.digest}`,
      context_ref: "context.synthetic.v1",
    };
    applyRaw(JSON.stringify(bound));
    await act(async () => { await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS + 1); });
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

  it("does not let a delayed supported file import replace an archive", async () => {
    await openDesigner();
    const supported = JSON.stringify(fixtureDefinitions[0].definition);
    let resolveText!: (value: string) => void;
    const file = new File([""], "supported.json", { type: "application/json" });
    Object.defineProperty(file, "text", {
      value: vi.fn(() => new Promise<string>((resolve) => { resolveText = resolve; })),
    });
    const input = document.querySelector<HTMLInputElement>('input[type="file"][accept="application/json,.json"]');
    expect(input).not.toBeNull();
    fireEvent.change(input!, { target: { files: [file] } });
    const archived = '{\n  "schema_version": "ascension.workflow/v2", "graphs": []\n}\n';
    applyRaw(archived);
    await act(async () => { resolveText(supported); });
    expect(screen.getByRole("textbox", { name: "Archived unsupported workflow definition JSON" })).toHaveValue(archived);
  });
});

describe("owner context binding catalog", () => {
  it("renders the owner-disclosed context bindings rather than inferring them", async () => {
    const client = new FixtureClient(fixtureDefinitions);
    const definition = fixtureDefinitions[0];
    render(<DesignerView client={client} catalog={fixtureDefinitions} definition={definition}
      initialDocument={definition.definition} mode="fixture" onBack={vi.fn()}
      onRun={vi.fn()} onRawTextChange={vi.fn()} />);
    const catalog = await screen.findByTestId("owner-context-catalog");
    expect(catalog).toHaveTextContent("context.fixture.v1");
    expect(catalog).not.toHaveTextContent("sts2.combat.context.v1");
    expect(catalog).toHaveTextContent("metadata-only");
  });
});

describe("diagnostics focus wiring", () => {
  afterEach(() => { vi.restoreAllMocks(); });

  /** The list editor marks SELECTED NODES with a `.node-list-row` that has
   * `aria-pressed="true"`. Graph-navigator tabs are also buttons, so selection
   * is asserted on node rows specifically rather than on any pressed button. */
  function selectedNodeRows(): HTMLElement[] {
    return screen.getAllByRole("button", { pressed: true })
      .filter((button) => button.classList.contains("node-list-row"));
  }

  const digest = "c".repeat(64);

  /** Renders the REAL DesignerView with a REAL owner-shaped validate response
   * and clicks the REAL focus button, so the production `onFocusNode` /
   * `onFocusPath` handlers are what is under test. Stubbing the handler with a
   * `vi.fn()`, as the panel test does, cannot see a focus target that resolves
   * to nothing at all — which is exactly how the inert control survived review.
   */
  async function renderWithOwnerResponse(inferenceProfiles: unknown, diagnostics: unknown[]): Promise<void> {
    const client = new FixtureClient(fixtureDefinitions);
    vi.spyOn(client, "validate").mockResolvedValue({
      schema_version: "ascension.management/v1",
      valid: true,
      definition_digest: digest,
      diagnostics,
      graph_count: 2,
      node_count: 11,
      compiler: "fixture",
      inference_profiles: inferenceProfiles,
    } as never);
    const definition = fixtureDefinitions.find((candidate) => candidate.id === "sts2.campaign.strict")!;
    render(<DesignerView client={client} catalog={fixtureDefinitions} definition={definition}
      initialDocument={definition.definition} mode="fixture" onBack={vi.fn()}
      onRun={vi.fn()} onRawTextChange={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "◈ Validate" }));
    await act(async () => {});
  }

  it("selects the correct node from a genuine index-based owner profile path", async () => {
    // The owner composes this path from ARRAY INDICES for graph 1 / node 1,
    // which in the campaign fixture is `campaign.iteration` /
    // `iteration_decide`. The path contains no id, so a substring match against
    // node ids selects nothing and the button is inert.
    await renderWithOwnerResponse(
      [{
        graph_id: "campaign.iteration",
        node_id: "iteration_decide",
        node_kind: "decide",
        profile_ref: "sts2.campaign.decision.v1",
        resolved_pin: `sts2.campaign.decision.v1:1.0.0:${digest}`,
        path: "$.graphs[1].nodes[1].config.decision_profile_ref",
      }],
      [],
    );
    const button = screen.getByRole("button", { name: "Focus $.graphs[1].nodes[1].config.decision_profile_ref" });
    expect(button).toBeInTheDocument();
    fireEvent.click(button);
    await act(async () => {});

    // The list editor is now shown and `iteration_decide` is the selected row.
    const rows = selectedNodeRows();
    expect(rows.length).toBe(1);
    expect(rows[0]).toHaveTextContent("iteration_decide");
    expect(rows[0]).toHaveTextContent("decide");
    // And specifically NOT a sibling that a wrong resolution would pick.
    expect(rows[0]).not.toHaveTextContent("iteration_observe");
  });

  it("selects the node the owner's own ids name, not the index the path carries", async () => {
    // `iteration_observe` is graph 1 / node 0. This entry deliberately pairs a
    // path pointing at index [1][1] with the ids of a DIFFERENT node, so a
    // resolver that trusted the path index or substring-matched would land on
    // `iteration_decide`. The owner's own ids are the only trustworthy key.
    await renderWithOwnerResponse(
      [{
        graph_id: "campaign.iteration",
        node_id: "iteration_observe",
        node_kind: "observe",
        profile_ref: "sts2.campaign.decision.v1",
        resolved_pin: `sts2.campaign.decision.v1:1.0.0:${digest}`,
        path: "$.graphs[1].nodes[1].config.decision_profile_ref",
      }],
      [],
    );
    fireEvent.click(screen.getByRole("button", { name: "Focus $.graphs[1].nodes[1].config.decision_profile_ref" }));
    await act(async () => {});
    const rows = selectedNodeRows();
    expect(rows.length).toBe(1);
    expect(rows[0]).toHaveTextContent("iteration_observe");
  });

  it("still resolves the owner's id-based diagnostic paths", async () => {
    // `management/validation.rs:120` composes `$.graphs.{graph_id}.nodes.{node_id}`.
    // These rows worked before this change and must keep working.
    await renderWithOwnerResponse(undefined, [
      { code: "bind.missing", severity: "error", path: "$.graphs.campaign.iteration.nodes.iteration_execute", message: "Missing binding." },
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Focus diagnostic $.graphs.campaign.iteration.nodes.iteration_execute" }));
    await act(async () => {});
    const rows = selectedNodeRows();
    expect(rows.length).toBe(1);
    expect(rows[0]).toHaveTextContent("iteration_execute");
  });

  it("selects nothing when an owner entry names a node this document lacks", async () => {
    await renderWithOwnerResponse(
      [{
        graph_id: "campaign.iteration",
        node_id: "absent_node",
        node_kind: "decide",
        profile_ref: "sts2.campaign.decision.v1",
        resolved_pin: `sts2.campaign.decision.v1:1.0.0:${digest}`,
        path: "$.graphs[1].nodes[1].config.decision_profile_ref",
      }],
      [],
    );
    fireEvent.click(screen.getByRole("button", { name: "Focus $.graphs[1].nodes[1].config.decision_profile_ref" }));
    await act(async () => {});
    expect(selectedNodeRows()).toHaveLength(0);
  });
});


describe("owner context catalog authority", () => {
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  const renderWith = async (ownerDelay: number, capabilitiesDelay: number): Promise<void> => {
    const client = new FixtureClient(fixtureDefinitions);
    const denied = catalogFixture("disabled");
    const capabilities = client.capabilities.bind(client);
    vi.spyOn(client, "capabilities").mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve(capabilities()), capabilitiesDelay)));
    vi.spyOn(client, "listContextBindings").mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve(denied), ownerDelay)));
    const definition = fixtureDefinitions[0];
    render(<DesignerView client={client} catalog={fixtureDefinitions} definition={definition}
      initialDocument={definition.definition} mode="fixture" onBack={vi.fn()}
      onRun={vi.fn()} onRawTextChange={vi.fn()} />);
    // Resolve and flush both responses before asserting the final authority.
    await act(async () => { await vi.advanceTimersByTimeAsync(Math.max(ownerDelay, capabilitiesDelay) + 20); });
  };

  it("keeps the owner authoritative when the catalog resolves last", async () => {
    vi.useFakeTimers();
    await renderWith(10, 1);
    expect(screen.getByTestId("owner-context-catalog")).toHaveTextContent("disabled");
    expect(screen.getByText(/No compatible references were disclosed/)).toBeInTheDocument();
    expect(screen.queryByText(/context.synthetic.v1 \(analyze, decide\)/)).not.toBeInTheDocument();
  });

  it("keeps the owner authoritative when the catalog resolves first", async () => {
    vi.useFakeTimers();
    await renderWith(1, 10);
    expect(screen.getByTestId("owner-context-catalog")).toHaveTextContent("disabled");
    expect(screen.getByText(/No compatible references were disclosed/)).toBeInTheDocument();
    expect(screen.queryByText(/context.synthetic.v1 \(analyze, decide\)/)).not.toBeInTheDocument();
  });
});
