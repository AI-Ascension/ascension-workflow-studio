import { userEvent } from "@testing-library/user-event";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { App } from "./App";

describe("Studio shell", () => {
  it("shows an explicit fixture library and opens the equivalent designer", async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Workflow library" })).toBeInTheDocument();
    expect(screen.getByText("fixture mode", { exact: false })).toBeInTheDocument();
    await user.click(screen.getAllByRole("button", { name: "Open designer" })[0]);
    expect(await screen.findByRole("heading", { name: "Strict setup" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "List editor" })).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "List editor" }));
    expect(screen.getByText("Semantic node list")).toBeInTheDocument();
  });

  it("exposes bounded raw JSON and template provenance entry points", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Workflow library" });
    await user.click(screen.getAllByRole("button", { name: "Clone draft" })[0]);
    expect(await screen.findByRole("heading", { name: /draft$/i })).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "List editor" }));
    await user.click(screen.getAllByRole("button", { name: /observe|decide|execute/i })[0]);
    expect(screen.getByText("Typed fields")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "JSON mode" }));
    expect(screen.getByRole("textbox", { name: "Raw workflow definition JSON" })).toBeInTheDocument();
    expect(screen.getByText("Bounded JSON mode")).toBeInTheDocument();
  });

  it("keeps unsupported definition text in a read-only archival panel", async () => {
    const user = userEvent.setup();
    const original = '{\n  "graphs": [],\n  "schema_version": "ascension.workflow/v2"\n}';
    render(<App />);
    await screen.findByRole("heading", { name: "Workflow library" });
    await user.click(screen.getAllByRole("button", { name: "Open designer" })[0]);
    await user.click(screen.getByRole("button", { name: "JSON mode" }));
    const editor = screen.getByRole("textbox", { name: "Raw workflow definition JSON" });
    fireEvent.change(editor, { target: { value: original } });
    await user.click(screen.getByRole("button", { name: "Apply candidate" }));
    const archived = await screen.findByRole("textbox", { name: "Archived unsupported workflow definition JSON" });
    expect(archived).toHaveValue(original);
    expect(archived).toHaveAttribute("readonly");
    expect(screen.getByText(/not applied to this draft, autosaved, validated, or published/i)).toBeInTheDocument();
  });
});
