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
  await expect(page.getByText(/Loaded the owner-backed draft\.|Autosaved to the active adapter\./)).toBeVisible();

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

  const stalePublish = await page.evaluate(async (id) => {
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
        client_mutation_id: "studio.live-browser.remote-publication-revision",
        document: current.document,
        layout: current.layout,
      }),
    });
    return { status: response.status, body: await response.json() };
  }, definitionId);
  expect(stalePublish.status).toBe(200);
  expect(stalePublish.body.revision).toBe(2);

  await page.getByRole("button", { name: "Publish revision" }).click();
  await expect(page.getByRole("heading", { name: "Local and remote drafts diverged" })).toBeVisible();
  await expect(page.locator(".validation-label")).toHaveText("Publication needs conflict resolution before it can create an immutable revision.");
});

test("retries a lost draft-save response with the original mutation identity", async ({ page }) => {
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
  await expect(page.getByText(/Loaded the owner-backed draft\.|Autosaved to the active adapter\./)).toBeVisible();
  const before = await page.evaluate(async (id) => {
    const response = await fetch(`/v1/studio/drafts/draft.${id}`, { headers: { Authorization: "Bearer studio-live-ci-token" } });
    return { status: response.status, body: await response.json() };
  }, definitionId);
  expect(before.status).toBe(200);

  let dropped = false;
  await page.route("**/v1/studio/drafts/**", async (route) => {
    if (!dropped && route.request().method() === "PUT") {
      dropped = true;
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      await route.abort("connectionreset");
      return;
    }
    await route.continue();
  });
  await page.getByRole("button", { name: "JSON mode" }).click();
  const raw = page.getByLabel("Raw workflow definition JSON");
  const candidate = JSON.parse(await raw.inputValue()) as { annotations: { summary: string } };
  candidate.annotations.summary = "Saved once despite a lost response";
  await raw.fill(JSON.stringify(candidate, null, 2));
  await page.getByRole("button", { name: "Apply candidate" }).click();
  await expect(page.getByRole("button", { name: "Retry save" })).toBeVisible();
  await page.getByRole("button", { name: "Retry save" }).click();
  await expect(page.getByText("Autosaved to the active adapter.")).toBeVisible();
  expect(dropped).toBe(true);

  const saved = await page.evaluate(async (id) => {
    const response = await fetch(`/v1/studio/drafts/draft.${id}`, { headers: { Authorization: "Bearer studio-live-ci-token" } });
    return { status: response.status, body: await response.json() };
  }, definitionId);
  expect(saved.status).toBe(200);
  expect(saved.body.revision).toBe(before.body.revision + 1);
  expect(saved.body.document.annotations.summary).toBe("Saved once despite a lost response");
});

test("keeps candidates on cancel and saves an explicitly reviewed non-overlapping merge", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open settings" }).click();
  await page.getByLabel("Bearer token").fill("studio-live-ci-token");
  await page.getByLabel("Authenticated actor subject").fill("profile:studio-live");
  await page.getByRole("button", { name: "Check owner connection" }).click();
  await page.getByRole("button", { name: /Live owner API/ }).click();
  await page.getByRole("button", { name: "Library", exact: true }).click();
  const card = page.locator(".definition-card").first();
  const definitionId = await card.locator(".card-id").textContent();
  expect(definitionId).not.toBeNull();
  await card.getByRole("button", { name: "Clone draft" }).click();
  await expect(page.getByText(/Loaded the owner-backed draft\.|Autosaved to the active adapter\./)).toBeVisible();

  const resetToRegistryDefinition = await page.evaluate(async (id) => {
    const headers = { Authorization: "Bearer studio-live-ci-token", "Content-Type": "application/json" };
    const draftPath = `/v1/studio/drafts/draft.${id}`;
    const current = await (await fetch(draftPath, { headers })).json();
    const definitions = await (await fetch("/v1/studio/definitions", { headers })).json();
    const definition = definitions.definitions.find((candidate: { id: string }) => candidate.id === id);
    const response = await fetch(draftPath, {
      method: "PUT",
      headers,
      body: JSON.stringify({
        schema_version: "ascension.studio-authoring/v1",
        expected_revision: current.revision,
        etag: current.etag,
        client_mutation_id: "studio.live-browser.reset-merge-base",
        document: definition.definition,
        layout: current.layout,
      }),
    });
    return { status: response.status, body: await response.json() };
  }, definitionId);
  expect(resetToRegistryDefinition.status).toBe(200);
  await page.getByRole("button", { name: "Library", exact: true }).click();
  await page.getByRole("button", { name: "Open designer" }).first().click();
  await expect(page.getByText("Loaded the owner-backed draft.")).toBeVisible();

  const remoteSave = await page.evaluate(async (id) => {
    const headers = { Authorization: "Bearer studio-live-ci-token", "Content-Type": "application/json" };
    const draftPath = `/v1/studio/drafts/draft.${id}`;
    const current = await (await fetch(draftPath, { headers })).json();
    current.document.game_profile = "sts2.remote.merge.v1";
    const response = await fetch(draftPath, {
      method: "PUT",
      headers,
      body: JSON.stringify({
        schema_version: "ascension.studio-authoring/v1",
        expected_revision: current.revision,
        etag: current.etag,
        client_mutation_id: "studio.live-browser.remote-merge-change",
        document: current.document,
        layout: current.layout,
      }),
    });
    return { status: response.status, body: await response.json() };
  }, definitionId);
  expect(remoteSave.status).toBe(200);

  await page.getByRole("button", { name: "JSON mode" }).click();
  const raw = page.getByLabel("Raw workflow definition JSON");
  const local = JSON.parse(await raw.inputValue()) as { version: string };
  local.version = "1.0.1";
  await raw.fill(JSON.stringify(local, null, 2));
  await page.getByRole("button", { name: "Apply candidate" }).click();
  await expect(page.getByRole("heading", { name: "Local and remote drafts diverged" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel resolution" }).click();
  await expect(page.getByText("Conflict resolution cancelled; local and remote candidates remain available for review.")).toBeVisible();
  await expect(raw).toHaveValue(/"version": "1.0.1"/);
  await page.getByRole("button", { name: "Apply non-overlapping merge" }).click();
  await expect(page.locator(".validation-label")).toHaveText("Non-overlapping semantic changes were merged; validation is required again.");
  await expect(raw).toHaveValue(/sts2.remote.merge.v1/);
  await expect(raw).toHaveValue(/"version": "1.0.1"/);
  await expect(page.getByText("Autosaved to the active adapter.")).toBeVisible();
});
