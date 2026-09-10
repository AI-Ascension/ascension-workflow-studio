import { userEvent } from "@testing-library/user-event";
import { render, screen } from "@testing-library/react";
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
});
