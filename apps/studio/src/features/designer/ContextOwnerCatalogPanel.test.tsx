import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FixtureClient } from "@studio/client";
import { fixtureDefinitions } from "../../fixtures/catalog";
import { catalogFixture } from "../../../../../packages/contracts/src/context-owner-catalog.test-fixtures";
import { DesignerView } from "./DesignerView";
import { ContextOwnerCatalogPanel } from "./ContextOwnerCatalogPanel";

describe("catalog rendering and editor selection", () => {
  it("renders all five restricted limits and an explicit zero-note ceiling", () => {
    const { rerender } = render(<ContextOwnerCatalogPanel state={{ status: "available", catalog: catalogFixture("restricted") }} refresh={vi.fn()} />);
    const region = screen.getByRole("region", { name: "Context descriptor context.fixture.v1" });
    expect(region).toHaveTextContent("Items8");
    expect(region).toHaveTextContent("Notes4");
    expect(region).toHaveTextContent("buffer16384");
    expect(region).toHaveTextContent("Objective bytes128");
    expect(region).toHaveTextContent("Recorded events128");
    rerender(<ContextOwnerCatalogPanel state={{ status: "available", catalog: catalogFixture("zero_notes") }} refresh={vi.fn()} />);
    expect(screen.getByRole("region", { name: "Context descriptor context.fixture.v1" })).toHaveTextContent("Notes0");
  });
  it("disables both inspectors after refresh failure while preserving an unsupported selection", async () => {
    const client = new FixtureClient(fixtureDefinitions);
    vi.spyOn(client, "listContextBindings").mockResolvedValueOnce(catalogFixture()).mockRejectedValueOnce(new Error("offline"));
    const definition = fixtureDefinitions[0];
    render(<DesignerView client={client} catalog={fixtureDefinitions} definition={definition}
      initialDocument={definition.definition} mode="fixture" onBack={vi.fn()}
      onRun={vi.fn()} onRawTextChange={vi.fn()} />);
    await screen.findByTestId("owner-context-catalog");
    fireEvent.click(screen.getByRole("tab", { name: "List editor" }));
    const row = [...document.querySelectorAll<HTMLButtonElement>(".node-list-row")]
      .find((button) => button.querySelector("strong")?.textContent === "decide");
    expect(row).toBeDefined();
    fireEvent.click(row!);
    let select = screen.getByRole("combobox", { name: "decide Decision context" });
    expect(select).toHaveValue("sts2.setup.context.v1");
    expect(select).not.toBeDisabled();
    expect(screen.getByRole("option", { name: /sts2.setup.context.v1.*not disclosed/ })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Refresh context catalog" }));
    expect(select).toBeDisabled();
    await waitFor(() => expect(within(screen.getByRole("region", { name: "Context reference catalog" })).getByRole("status")).toHaveTextContent("could not be admitted"));
    expect(select).toHaveValue("sts2.setup.context.v1");
    await act(async () => fireEvent.click(screen.getByRole("tab", { name: "Canvas" })));
    select = screen.getByRole("combobox", { name: "decide Decision context" });
    expect(select).toBeDisabled();
    expect(select).toHaveValue("sts2.setup.context.v1");
    fireEvent.change(select, { target: { value: "context.fixture.v1" } });
    expect(select).toHaveValue("sts2.setup.context.v1");
  });
});
