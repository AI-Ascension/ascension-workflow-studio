import { expect, test } from "@playwright/test";

test("pairs with the authenticated owner through the same-origin adapter", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open settings" }).click();
  await page.getByLabel("Bearer token").fill("studio-live-ci-token");
  await page.getByLabel("Authenticated actor subject").fill("profile:studio-live");
  await page.getByRole("button", { name: "Check owner connection" }).click();
  await expect(page.locator(".connection-message")).toContainText("Owner reports ok.");
  await page.getByRole("button", { name: /Live owner API/ }).click();
  await expect(page.getByRole("complementary").getByText("Live owner API", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Library", exact: true }).click();
  await page.getByRole("button", { name: /New draft/ }).click();
  await expect(page.getByText("Autosaved to the active adapter.")).toBeVisible();
  await page.getByRole("button", { name: "Library", exact: true }).click();
  await page.getByRole("button", { name: "Open designer" }).first().click();
  await expect(page.getByText("Loaded the owner-backed draft.")).toBeVisible();
  await page.getByRole("button", { name: "Run inspection" }).click();
  await expect(page.getByRole("heading", { name: "Run inspector" })).toBeVisible();
  await expect(page.getByText("live API", { exact: true })).toBeVisible();
  await expect(page.getByText(/Loaded \d+ retained event/)).toBeVisible();
  await page.getByRole("button", { name: "Library", exact: true }).click();
  await page.getByRole("button", { name: "Open designer" }).first().click();
  await expect(page.getByText("Loaded the owner-backed draft.")).toBeVisible();
  await page.getByRole("button", { name: /Validate/ }).click();
  await expect(page.locator(".validation-label")).toHaveText(/Validated at /);
  await page.getByRole("button", { name: "Publish revision" }).click();
  await expect(page.locator(".validation-label")).toHaveText(/Published an immutable owner revision\.|This exact semantic digest is already published\./);
  await page.getByRole("button", { name: "Library", exact: true }).click();
  await page.getByRole("button", { name: "Refresh library" }).click();
  await expect(page.getByText("published", { exact: true })).toBeVisible();
});

test("renders an owner revision conflict after a stale browser save", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open settings" }).click();
  await page.getByLabel("Bearer token").fill("studio-live-ci-token");
  await page.getByLabel("Authenticated actor subject").fill("profile:studio-live");
  await page.getByRole("button", { name: "Check owner connection" }).click();
  await page.getByRole("button", { name: /Live owner API/ }).click();
  await page.getByRole("button", { name: "Library", exact: true }).click();
  const definitionId = await page.locator(".definition-card").first().locator(".card-id").textContent();
  expect(definitionId).not.toBeNull();
  await page.getByRole("button", { name: "Clone draft" }).first().click();
  await expect(page.getByText("Autosaved to the active adapter.")).toBeVisible();

  const remoteSave = await page.evaluate(async (id) => {
    const headers = { Authorization: "Bearer studio-live-ci-token", "Content-Type": "application/json" };
    const draftPath = `/v1/studio/drafts/draft.${id}`;
    const currentResponse = await fetch(draftPath, { headers });
    const current = await currentResponse.json();
    const response = await fetch(draftPath, {
      method: "PUT",
      headers,
      body: JSON.stringify({
        schema_version: "ascension.studio-authoring/v1",
        expected_revision: current.revision,
        etag: current.etag,
        client_mutation_id: "studio.live-browser.remote-revision",
        document: current.document,
        layout: current.layout,
      }),
    });
    return { status: response.status, body: await response.json() };
  }, definitionId);
  expect(remoteSave.status).toBe(200);
  expect(remoteSave.body.revision).toBe(1);

  await page.getByRole("button", { name: "JSON mode" }).click();
  const raw = page.getByLabel("Raw workflow definition JSON");
  const local = JSON.parse(await raw.inputValue()) as { annotations: { summary: string } };
  local.annotations.summary = "Local stale browser candidate";
  await raw.fill(JSON.stringify(local, null, 2));
  await page.getByRole("button", { name: "Apply candidate" }).click();
  await expect(page.getByRole("heading", { name: "Local and remote drafts diverged" })).toBeVisible();
  await page.getByRole("button", { name: "Reload remote" }).click();
  await expect(page.getByText("Remote revision loaded; local conflict was discarded.")).toBeVisible();
  await expect(page.getByText("saved", { exact: true })).toBeVisible();
});
