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
