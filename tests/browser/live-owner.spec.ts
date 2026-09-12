import { expect, test, type Page } from "@playwright/test";

async function connectLiveOwner(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: "Open settings" }).click();
  await page.getByLabel("Bearer token").fill("studio-live-ci-token");
  await page.getByLabel("Authenticated actor subject").fill("profile:studio-live");
  await page.getByRole("button", { name: "Check owner connection" }).click();
  await expect(page.locator(".connection-message")).toContainText("Owner reports ok.");
  await page.getByRole("button", { name: /Live owner API/ }).click();
}

async function openOwnedDraft(page: Page): Promise<string> {
  await page.getByRole("button", { name: "Library", exact: true }).click();
  const definitionId = await page.locator(".definition-card").first().locator(".card-id").textContent();
  expect(definitionId).not.toBeNull();
  await page.getByRole("button", { name: "Clone draft" }).first().click();
  await expect(page.getByText(/Loaded the owner-backed draft\.|Autosaved to the active adapter\./)).toBeVisible();
  await page.getByRole("button", { name: "Library", exact: true }).click();
  await page.getByRole("button", { name: "Open designer" }).first().click();
  await expect(page.getByText("Loaded the owner-backed draft.")).toBeVisible();
  return definitionId ?? "";
}

async function reopenDesigner(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Library", exact: true }).click();
  await page.getByRole("button", { name: "Open designer" }).first().click();
  await expect(page.getByText("Loaded the owner-backed draft.")).toBeVisible();
}

async function ownerResetBase(page: Page, definitionId: string): Promise<void> {
  const result = await page.evaluate(async (id) => {
    const headers = { Authorization: "Bearer studio-live-ci-token", "Content-Type": "application/json" };
    const draftPath = `/v1/studio/drafts/draft.${id}`;
    const current = await (await fetch(draftPath, { headers })).json();
    const definitions = await (await fetch("/v1/studio/definitions", { headers })).json();
    const definition = definitions.definitions.find((candidate: { id: string }) => candidate.id === id);
    const baseDocument = definition ? definition.definition : current.document;
    const response = await fetch(draftPath, { method: "PUT", headers, body: JSON.stringify({
      schema_version: "ascension.studio-authoring/v1",
      expected_revision: current.revision,
      etag: current.etag,
      client_mutation_id: `studio.live-browser.reset-base.${Date.now()}`,
      document: baseDocument,
      layout: current.layout,
    }) });
    return { status: response.status, revision: (await response.json()).revision };
  }, definitionId);
  expect(result.status).toBe(200);
}

async function ownerMutate(page: Page, definitionId: string, mutation: string, mutationId: string): Promise<void> {
  const result = await page.evaluate(async ({ id, mutation, mutationId }) => {
    const headers = { Authorization: "Bearer studio-live-ci-token", "Content-Type": "application/json" };
    const draftPath = `/v1/studio/drafts/draft.${id}`;
    const current = await (await fetch(draftPath, { headers })).json();
    const document = current.document;
    const layout = current.layout;
    if (mutation === "game_profile") document.game_profile = "sts2.remote.merge.v1";
    else if (mutation === "version") document.version = "2.0.0";
    else if (mutation === "edge_priority") document.graphs[0].edges[0].priority = 9;
    else if (mutation === "delete_node") document.graphs[0].nodes.splice(1, 1);
    else if (mutation === "layout") {
      const key = Object.keys(layout.positions)[0];
      layout.positions[key] = { x: 1234, y: 5678 };
    } else throw new Error(`unknown mutation ${mutation}`);
    const response = await fetch(draftPath, { method: "PUT", headers, body: JSON.stringify({
      schema_version: "ascension.studio-authoring/v1",
      expected_revision: current.revision,
      etag: current.etag,
      client_mutation_id: mutationId,
      document,
      layout,
    }) });
    return { status: response.status, revision: (await response.json()).revision };
  }, { id: definitionId, mutation, mutationId });
  expect(result.status).toBe(200);
}

async function openRawCandidate(page: Page): Promise<import("@playwright/test").Locator> {
  await page.getByRole("button", { name: "JSON mode" }).click();
  return page.getByLabel("Raw workflow definition JSON");
}

async function openExistingDraft(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Library", exact: true }).click();
  await page.getByRole("button", { name: "Open designer" }).first().click();
  await expect(page.getByText("Loaded the owner-backed draft.")).toBeVisible();
}

async function applyLocalEdit(page: Page, edit: (document: { version: string; graphs: Array<{ nodes: Array<{ config: Record<string, unknown> }>; edges: Array<Record<string, unknown>> }> }) => void): Promise<void> {
  const raw = await openRawCandidate(page);
  const local = JSON.parse(await raw.inputValue());
  edit(local);
  await raw.fill(JSON.stringify(local, null, 2));
  await page.getByRole("button", { name: "Apply candidate" }).click();
}

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
  await page.getByRole("button", { name: "Reload remote…" }).click();
  await expect(page.getByText("Reloading replaces the local candidate with the owner revision and cannot be undone.")).toBeVisible();
  await page.getByRole("button", { name: "Discard local and reload remote" }).click();
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

test("cancels conflict resolution, preserves local content, and saves it as a new draft", async ({ page }) => {
  await connectLiveOwner(page);
  const definitionId = await openOwnedDraft(page);
  await ownerResetBase(page, definitionId);
  await reopenDesigner(page);
  await ownerMutate(page, definitionId, "game_profile", "studio.live-browser.cancel-remote");
  await applyLocalEdit(page, (local) => { local.version = "1.0.1"; });
  const panel = page.getByRole("heading", { name: "Local and remote drafts diverged" });
  await expect(panel).toBeVisible();
  await page.getByRole("button", { name: "Cancel resolution" }).click();
  await expect(panel).not.toBeVisible();
  await expect(page.getByText("Conflict resolution cancelled; local and remote candidates remain available for review.")).toBeVisible();
  const raw = page.getByLabel("Raw workflow definition JSON");
  await expect(raw).toHaveValue(/"version": "1.0.1"/);
  await page.getByRole("button", { name: "Review divergence" }).click();
  await expect(panel).toBeVisible();
  await page.getByRole("button", { name: "Save local as new draft" }).click();
  await expect(page.getByText("Local candidate was saved as a new draft.")).toBeVisible();
  await expect(raw).toHaveValue(/"version": "1.0.1"/);
});

test("protects remote reload behind an explicit discard confirmation", async ({ page }) => {
  await connectLiveOwner(page);
  const definitionId = await openOwnedDraft(page);
  await ownerResetBase(page, definitionId);
  await reopenDesigner(page);
  await ownerMutate(page, definitionId, "game_profile", "studio.live-browser.protected-remote");
  await applyLocalEdit(page, (local) => { local.version = "1.0.1"; });
  await expect(page.getByRole("heading", { name: "Local and remote drafts diverged" })).toBeVisible();
  const raw = page.getByLabel("Raw workflow definition JSON");
  await page.getByRole("button", { name: "Reload remote…" }).click();
  await expect(page.getByText("Reloading replaces the local candidate with the owner revision and cannot be undone.")).toBeVisible();
  await page.getByRole("button", { name: "Keep local edits" }).click();
  await expect(page.getByText("Reloading replaces the local candidate with the owner revision and cannot be undone.")).not.toBeVisible();
  await expect(raw).toHaveValue(/"version": "1.0.1"/);
  await page.getByRole("button", { name: "Reload remote…" }).click();
  await page.getByRole("button", { name: "Discard local and reload remote" }).click();
  await expect(page.getByText("Remote revision loaded; local conflict was discarded.")).toBeVisible();
  await expect(raw).toHaveValue(/sts2.remote.merge.v1/);
  await expect(raw).not.toHaveValue(/"version": "1.0.1"/);
});

test("merges non-overlapping semantic and layout candidates and revalidates them", async ({ page }) => {
  await connectLiveOwner(page);
  const definitionId = await openOwnedDraft(page);
  await ownerResetBase(page, definitionId);
  await reopenDesigner(page);
  await ownerMutate(page, definitionId, "game_profile", "studio.live-browser.merge-remote");
  await ownerMutate(page, definitionId, "layout", "studio.live-browser.merge-layout");
  await applyLocalEdit(page, (local) => { local.version = "1.0.1"; });
  const panel = page.getByRole("heading", { name: "Local and remote drafts diverged" });
  await expect(panel).toBeVisible();
  await expect(page.getByText(/layout movement merges independently/)).toBeVisible();
  await page.getByRole("button", { name: "Apply non-overlapping merge" }).click();
  await expect(page.locator(".validation-label")).toHaveText(/Merged semantic and layout candidates revalidated at /);
  await expect(panel).not.toBeVisible();
  const raw = page.getByLabel("Raw workflow definition JSON");
  await expect(raw).toHaveValue(/sts2.remote.merge.v1/);
  await expect(raw).toHaveValue(/"version": "1.0.1"/);
  await expect(page.getByText("Autosaved to the active adapter.")).toBeVisible();
});

test("requires review for a conflicting semantic edit and keeps the local candidate", async ({ page }) => {
  await connectLiveOwner(page);
  const definitionId = await openOwnedDraft(page);
  await ownerResetBase(page, definitionId);
  await reopenDesigner(page);
  await ownerMutate(page, definitionId, "version", "studio.live-browser.conflicting-version");
  await applyLocalEdit(page, (local) => { local.version = "1.0.1"; });
  await expect(page.getByRole("heading", { name: "Local and remote drafts diverged" })).toBeVisible();
  await expect(page.getByText(/1 conflicts/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Apply non-overlapping merge" })).toBeDisabled();
  await expect(page.getByLabel("Raw workflow definition JSON")).toHaveValue(/"version": "1.0.1"/);
});

test("flags a delete-versus-edit node change for review instead of merging silently", async ({ page }) => {
  await connectLiveOwner(page);
  const definitionId = await openOwnedDraft(page);
  await ownerResetBase(page, definitionId);
  await reopenDesigner(page);
  await ownerMutate(page, definitionId, "delete_node", "studio.live-browser.delete-node");
  await applyLocalEdit(page, (local) => { local.graphs[0].nodes[1].config = { ...local.graphs[0].nodes[1].config, edited_locally: "yes" }; });
  await expect(page.getByRole("heading", { name: "Local and remote drafts diverged" })).toBeVisible();
  await expect(page.locator(".conflict-panel .status-badge")).toContainText("conflicts");
  await expect(page.getByRole("button", { name: "Apply non-overlapping merge" })).toBeDisabled();
  await expect(page.getByLabel("Raw workflow definition JSON")).toHaveValue(/edited_locally/);
});

test("flags reordered branches against a remote edge change for review", async ({ page }) => {
  await connectLiveOwner(page);
  const definitionId = await openOwnedDraft(page);
  await ownerResetBase(page, definitionId);
  await reopenDesigner(page);
  await ownerMutate(page, definitionId, "edge_priority", "studio.live-browser.remote-edge");
  await applyLocalEdit(page, (local) => {
    const edges = local.graphs[0].edges;
    local.graphs[0].edges = [edges[1], edges[0], ...edges.slice(2)];
  });
  await expect(page.getByRole("heading", { name: "Local and remote drafts diverged" })).toBeVisible();
  await expect(page.locator(".conflict-panel .status-badge")).toContainText("conflicts");
  await expect(page.getByRole("button", { name: "Apply non-overlapping merge" })).toBeDisabled();
  await expect(page.getByLabel("Raw workflow definition JSON")).toHaveValue(/"priority":/);
});

test("keeps draft, definition, layout, and compiler identities independent", async ({ page }) => {
  await connectLiveOwner(page);
  await openOwnedDraft(page);
  await page.getByRole("button", { name: /Validate/ }).click();
  await expect(page.locator(".validation-label")).toHaveText(/Validated at /);
  const compiler = page.getByTestId("identity-compiler");
  await expect(compiler).toHaveText("sts2-harness.workflow-compiler.v1");
  const definitionDigest = page.getByTestId("identity-definition-digest");
  const layoutDigest = page.getByTestId("identity-layout-digest");
  const definitionBefore = await definitionDigest.textContent();
  expect(definitionBefore).not.toBeNull();
  expect(definitionBefore).not.toBe("not validated");
  await expect(definitionDigest).not.toHaveText("sts2-harness.workflow-compiler.v1");
  await expect(layoutDigest).not.toHaveText("sts2-harness.workflow-compiler.v1");

  await page.getByRole("button", { name: "Auto-layout" }).click();
  await expect(definitionDigest).toHaveText(definitionBefore ?? "");
  await expect(compiler).toHaveText("sts2-harness.workflow-compiler.v1");

  await page.getByRole("button", { name: "JSON mode" }).click();
  const raw = page.getByLabel("Raw workflow definition JSON");
  const local = JSON.parse(await raw.inputValue()) as { limits: { max_steps: number } };
  local.limits.max_steps += 1;
  await raw.fill(JSON.stringify(local, null, 2));
  await page.getByRole("button", { name: "Apply candidate" }).click();
  await page.getByRole("button", { name: /Validate/ }).click();
  await expect(page.locator(".validation-label")).toHaveText(/Validated at /);
  await expect(definitionDigest).not.toHaveText(definitionBefore ?? "");
  await expect(compiler).toHaveText("sts2-harness.workflow-compiler.v1");
});

test("two tabs: a conflicting pinned reference change requires review", async ({ context, page }) => {
  await connectLiveOwner(page);
  const definitionId = await openOwnedDraft(page);
  await ownerResetBase(page, definitionId);
  await reopenDesigner(page);
  const second = await context.newPage();
  await connectLiveOwner(second);
  await openExistingDraft(second);

  await applyLocalEdit(page, (local) => { local.graphs[0].nodes[0].config.projection_ref = "approved.pinned.a"; });
  await expect(page.getByText("Autosaved to the active adapter.")).toBeVisible();

  await applyLocalEdit(second, (local) => { local.graphs[0].nodes[0].config.projection_ref = "approved.pinned.b"; });
  await expect(second.getByRole("heading", { name: "Local and remote drafts diverged" })).toBeVisible();
  const panel = second.locator(".conflict-panel");
  await expect(panel.locator(".status-badge")).toContainText("conflicts");
  await expect(panel.getByText("Local paths")).toBeVisible();
  await expect(panel.getByText("Remote paths")).toBeVisible();
  await expect(second.getByRole("button", { name: "Apply non-overlapping merge" })).toBeDisabled();
  await expect(second.getByLabel("Raw workflow definition JSON")).toHaveValue(/approved.pinned.b/);
  await expect(page.getByLabel("Raw workflow definition JSON")).toHaveValue(/approved.pinned.a/);
});

test("resolves a lost command response by the original command id", async ({ page }) => {
  await connectLiveOwner(page);
  await openOwnedDraft(page);
  await page.getByRole("button", { name: "Run inspection" }).click();
  await expect(page.getByRole("heading", { name: "Run inspector" })).toBeVisible();
  await expect(page.getByText("live API", { exact: true })).toBeVisible();
  const pause = page.getByRole("button", { name: "Pause" });
  await expect(pause).toBeEnabled();

  let dropped = false;
  await page.route("**/v1/workflow-runs/**/commands", async (route) => {
    if (!dropped && route.request().method() === "POST") {
      dropped = true;
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      await route.abort("connectionreset");
      return;
    }
    await route.continue();
  });

  await pause.click();
  const outcome = page.locator(".command-outcome");
  await expect(outcome).toHaveAttribute("data-command-state", "unknown");
  await expect(outcome).toContainText("No response for command");
  await expect(outcome).not.toContainText("applied at revision");
  const detail = (await outcome.locator(".command-detail").textContent()) ?? "";
  const commandId = /studio\.command\.[^\s.]+\.[0-9]+/.exec(detail)?.[0] ?? "";
  expect(commandId).not.toBe("");
  expect(dropped).toBe(true);

  await page.getByRole("button", { name: "Check outcome" }).click();
  await expect(outcome).toHaveAttribute("data-command-state", "settled");
  await expect(outcome).toContainText(commandId);
  await expect(outcome).toContainText(/applied at revision|admitted but not applied|pending|already resolved/);
});
