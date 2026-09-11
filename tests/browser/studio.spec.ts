import { expect, test } from "@playwright/test";

test.describe("Studio fixture workbench", () => {
  test("opens a template, uses the non-canvas editor, and keeps fixture mode explicit", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Workflow library" })).toBeVisible();
    await expect(page.getByText("Fixture mode")).toBeVisible();
    await page.getByRole("button", { name: "Clone draft" }).first().click();
    await expect(page.getByRole("heading", { name: /draft$/i })).toBeVisible();
    await page.getByRole("tab", { name: "List editor" }).click();
    await expect(page.getByRole("heading", { name: "Semantic node list" })).toBeVisible();
    await page.getByRole("button", { name: "JSON mode" }).click();
    await expect(page.getByRole("textbox", { name: "Raw workflow definition JSON" })).toBeVisible();
    await page.screenshot({ path: "test-results/studio-designer.png", fullPage: true });
  });

  test("renders graph nodes with an explicit high-contrast surface", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Open designer" }).first().click();
    const node = page.locator(".react-flow__node").first();
    await expect(node).toBeVisible();
    await expect(node).toHaveCSS("background-color", "rgb(219, 234, 254)");
    await expect(node).toHaveCSS("color", "rgb(16, 34, 56)");
    await expect(node).toHaveCSS("border-top-color", "rgb(94, 155, 209)");
  });

  test("edits typed three-valued guard branches and keeps unknown explicit", async ({ page }) => {
    const definition = {
      schema_version: "ascension.workflow/v1", workflow_id: "guard.test", version: "1.0.0", mode: "strict", game_profile: "test", policy_ref: "test.policy",
      capabilities: { required: [], optional: [] }, limits: { max_steps: 4, max_subworkflow_depth: 1, max_provider_calls: 0, max_parallel_analyses: 1, max_output_tokens: 128 }, entry_graph: "main",
      graphs: [{ id: "main", entry_node: "observe", nodes: [
        { id: "observe", kind: "observe", config: { projection_ref: "approved.state" } }, { id: "route", kind: "route", config: { selector_ref: "approved.outcome" } },
        { id: "completed", kind: "terminal", config: { outcome: "completed" } }, { id: "blocked", kind: "terminal", config: { outcome: "blocked" } },
      ], edges: [
        { from: "observe", to: "route", on: "ok", priority: 0 }, { from: "route", to: "completed", on: "true", priority: 0 }, { from: "route", to: "blocked", on: "unknown", priority: 1 },
      ], guards: [{ id: "outcome.present", expression: { kind: "exists", value: "approved.outcome" } }] }],
    };
    await page.goto("/");
    await page.getByRole("button", { name: "Open designer" }).first().click();
    await page.getByRole("button", { name: "JSON mode" }).click();
    await page.getByRole("textbox", { name: "Raw workflow definition JSON" }).fill(JSON.stringify(definition));
    await page.getByRole("button", { name: "Apply candidate" }).click();
    await expect(page.getByRole("alert")).toContainText("Missing explicit exits: false");
    await expect(page.getByLabel("outcome.present observation field")).toHaveValue("approved.outcome");
    await page.getByLabel("route branch 1 outcome").selectOption("false");
    await expect(page.getByLabel("route false target")).toHaveValue("completed");
    await page.getByRole("button", { name: "Move unknown branch earlier" }).click();
    await expect(page.getByLabel("route branch 1 outcome")).toHaveValue("unknown");
    await page.getByLabel("outcome.present observation field").fill("");
    await page.getByLabel("outcome.present observation field").blur();
    await expect(page.getByRole("alert")).toContainText("missing data must remain unknown");
  });

  test("shows safe run controls and replay compare without leaving the app", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Runs", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Run inspector" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
    await page.getByRole("button", { name: "Replay / Compare" }).click();
    await expect(page.getByRole("heading", { name: "Replay & compare" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Replay & compare" })).toBeVisible();
  });

  test("keeps an unsupported import as exact read-only text", async ({ page }) => {
    const original = '{\n  "graphs": [],\n  "schema_version": "ascension.workflow/v2"\n}';
    await page.goto("/");
    await page.getByRole("button", { name: "Open designer" }).first().click();
    await page.getByRole("button", { name: "JSON mode" }).click();
    await page.getByRole("textbox", { name: "Raw workflow definition JSON" }).fill(original);
    await page.getByRole("button", { name: "Apply candidate" }).click();
    const archived = page.getByRole("textbox", { name: "Archived unsupported workflow definition JSON" });
    await expect(archived).toHaveValue(original);
    await expect(archived).toHaveAttribute("readonly", "");
    await expect(page.getByText(/not applied to this draft, autosaved, validated, or published/i)).toBeVisible();
  });

  test("rejects duplicate-key JSON without mutating the draft", async ({ page }) => {
    const duplicateKeys = '{"schema_version":"ascension.workflow/v1","schema_version":"ascension.workflow/v1"}';
    await page.goto("/");
    await page.getByRole("button", { name: "Clone draft" }).first().click();
    await expect(page.getByText("Autosaved to the active adapter.")).toBeVisible();
    await page.getByRole("button", { name: "JSON mode" }).click();
    const editor = page.getByRole("textbox", { name: "Raw workflow definition JSON" });
    await editor.fill(duplicateKeys);
    await page.getByRole("button", { name: "Apply candidate" }).click();
    await expect(editor).toHaveValue(duplicateKeys);
    await expect(page.getByRole("alert")).toContainText("duplicate key");
    await expect(page.getByText("Autosaved to the active adapter.")).toBeVisible();
  });

  test("retains malformed JSON locally and only persists a repaired atomic candidate", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Clone draft" }).first().click();
    await expect(page.getByText("Autosaved to the active adapter.")).toBeVisible();
    await page.getByRole("button", { name: "JSON mode" }).click();
    const editor = page.getByRole("textbox", { name: "Raw workflow definition JSON" });
    const baseline = await editor.inputValue();
    const malformed = '{"schema_version":';
    await editor.fill(malformed);
    await page.getByRole("button", { name: "Apply candidate" }).click();
    await expect(editor).toHaveValue(malformed);
    await expect(page.getByRole("alert")).toBeVisible();

    await page.getByRole("button", { name: "Library", exact: true }).click();
    await page.getByRole("button", { name: "Open designer" }).first().click();
    await page.getByRole("button", { name: "JSON mode" }).click();
    const reopened = page.getByRole("textbox", { name: "Raw workflow definition JSON" });
    await expect(reopened).toHaveValue(malformed);

    const repaired = JSON.parse(baseline) as { annotations: { summary: string } };
    repaired.annotations.summary = "Repaired browser candidate";
    await reopened.fill(JSON.stringify(repaired, null, 2));
    await page.getByRole("button", { name: "Apply candidate" }).click();
    await expect(page.locator(".validation-label")).toHaveText("Applied the bounded canonical JSON definition as a new semantic candidate.");
    await expect(page.getByText("Autosaved to the active adapter.")).toBeVisible();

    await page.getByRole("button", { name: "Library", exact: true }).click();
    await page.getByRole("button", { name: "Open designer" }).first().click();
    await page.getByRole("button", { name: "JSON mode" }).click();
    await expect(page.getByRole("textbox", { name: "Raw workflow definition JSON" })).toHaveValue(/Repaired browser candidate/);
  });

  test("keeps graph shortcuts out of focused text fields and supports bounded history shortcuts", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Clone draft" }).first().click();
    await page.getByRole("tab", { name: "List editor" }).click();
    const rows = page.locator(".node-list-row");
    const initialCount = await rows.count();
    await page.getByRole("button", { name: "＋ Node" }).click();
    await expect(rows).toHaveCount(initialCount + 1);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press("Control+z");
    await expect(rows).toHaveCount(initialCount);
    await page.keyboard.press("Control+Shift+z");
    await expect(rows).toHaveCount(initialCount + 1);

    await page.getByRole("button", { name: "JSON mode" }).click();
    const editor = page.getByRole("textbox", { name: "Raw workflow definition JSON" });
    const baseline = await editor.inputValue();
    await editor.press("End");
    await editor.pressSequentially(" ");
    expect(await editor.inputValue()).not.toBe(baseline);
    await editor.press("Control+z");
    await expect(editor).toHaveValue(baseline);
    await editor.press("Delete");
    await expect(rows).toHaveCount(initialCount + 1);
  });

  test("multi-selects, aligns, auto-arranges, and restores layout with undo and redo", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Clone draft" }).first().click();
    await page.getByRole("tab", { name: "List editor" }).click();
    const rows = page.locator(".node-list-row");
    await expect(rows.nth(1)).toBeVisible();
    await rows.nth(0).click();
    await rows.nth(1).click({ modifiers: ["Control"] });
    await expect(rows.nth(0)).toHaveAttribute("aria-pressed", "true");
    await expect(rows.nth(1)).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Align X" }).click();
    await expect(page.locator(".validation-label")).toHaveText("Aligned the selected nodes without changing semantic execution.");
    await page.getByRole("button", { name: "Auto-layout" }).click();
    await expect(page.locator(".validation-label")).toHaveText("Auto-arranged the layout without changing semantic execution.");
    await page.getByRole("tab", { name: "Canvas" }).click();
    const nodes = page.locator(".react-flow__node");
    const arranged = await nodes.nth(1).evaluate((node) => getComputedStyle(node).transform);
    await page.getByRole("button", { name: "Undo" }).click();
    await expect.poll(() => nodes.nth(1).evaluate((node) => getComputedStyle(node).transform)).not.toBe(arranged);
    const undone = await nodes.nth(1).evaluate((node) => getComputedStyle(node).transform);
    await page.getByRole("button", { name: "Redo" }).click();
    await expect.poll(() => nodes.nth(1).evaluate((node) => getComputedStyle(node).transform)).toBe(arranged);
    expect(undone).not.toBe(arranged);
  });
});
