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
});
