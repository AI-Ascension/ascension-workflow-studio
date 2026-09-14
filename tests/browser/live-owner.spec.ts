import { readFileSync } from "node:fs";

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

/// Studio no longer submits a hardcoded synthetic target. Exercise the real
/// catalog -> exact preflight -> submission path against the authenticated owner
/// before the run inspector assertions.
async function startLiveRun(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Run inspection" }).click();
  const panel = page.getByRole("region", { name: "Run admission" });
  await expect(panel).toBeVisible();
  await panel.getByLabel("Target instance").selectOption("sts2-synthetic-1");
  await expect(panel.getByLabel("Execution profile")).toHaveValue("");
  await panel.getByLabel("Execution profile").selectOption("synthetic");
  await panel.getByLabel("Game profile").selectOption("sts2-synthetic-v1");
  await panel.getByRole("button", { name: "Run preflight" }).click();
  await expect(panel.getByLabel("Exact admission binding")).toBeVisible();
  await panel.getByRole("button", { name: "Start run" }).click();
  await expect(panel).toHaveCount(0);
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

async function readDownloadedBundle(page: Page, trigger: () => Promise<void>): Promise<string> {
  const [download] = await Promise.all([page.waitForEvent("download"), trigger()]);
  const path = await download.path();
  expect(path).not.toBeNull();
  return readFileSync(path as string, "utf8");
}

async function validateAndReadDigest(page: Page): Promise<string> {
  await page.getByRole("button", { name: /Validate/ }).click();
  await expect(page.locator(".validation-label")).toHaveText(/Validated at /);
  return (await page.getByTestId("identity-definition-digest").textContent()) ?? "";
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

test("round-trips strict and dynamic definitions through the owner without semantic drift", async ({ page }) => {
  await connectLiveOwner(page);

  const roundTrip = async (cardId: string, expectAdaptive: boolean): Promise<void> => {
    await page.getByRole("button", { name: "Library", exact: true }).click();
    const card = page.locator(".definition-card").filter({ hasText: cardId });
    await expect(card).toHaveCount(1);
    await card.getByRole("button", { name: "Clone draft" }).click();
    await expect(page.getByText(/Loaded the owner-backed draft\.|Autosaved to the active adapter\./)).toBeVisible();
    await page.getByRole("button", { name: "Library", exact: true }).click();
    await page.locator(".definition-card").filter({ hasText: cardId }).getByRole("button", { name: "Open designer" }).click();
    await expect(page.getByText("Loaded the owner-backed draft.")).toBeVisible();
    // The designer discovers the owner-disclosed context-binding catalog.
    await expect(page.getByTestId("owner-context-catalog")).toContainText("context.synthetic.v1");

    const before = await validateAndReadDigest(page);
    expect(before).not.toBe("not validated");
    if (expectAdaptive) {
      await page.getByRole("tab", { name: "List editor" }).click();
      await expect(page.locator(".node-list-row", { hasText: "iteration_adaptive" })).toBeVisible();
      await page.getByRole("tab", { name: "Canvas" }).click();
    }
    const bundle = await readDownloadedBundle(page, () => page.getByRole("button", { name: "Export", exact: true }).click());
    expect(bundle).toContain("ascension.studio-bundle/v1");
    expect(bundle).toContain(cardId);

    await page.setInputFiles('input[type="file"]', { name: "round-trip.studio.json", mimeType: "application/json", buffer: Buffer.from(bundle) });
    const preview = page.getByLabel("Imported bundle preview");
    await expect(preview).toBeVisible();
    await expect(preview).toContainText(cardId);
    await expect(preview).toContainText("No semantic differences from the current document.");
    await preview.getByRole("button", { name: "Apply imported bundle" }).click();
    await expect(page.locator(".validation-label")).toHaveText(/Imported and verified a digest-bound Studio bundle\.|Autosaved to the active adapter\./);
    const after = await validateAndReadDigest(page);
    expect(after).toBe(before);
    if (expectAdaptive) {
      await page.getByRole("tab", { name: "List editor" }).click();
      await expect(page.locator(".node-list-row", { hasText: "iteration_adaptive" })).toBeVisible();
    }
  };

  await roundTrip("sts2.setup.strict", false);
  await roundTrip("sts2.combat.dynamic", true);
});

test("imports, edits, exports, and owner-validates every admitted node kind", async ({ page }) => {
  await connectLiveOwner(page);
  await openOwnedDraft(page);
  const golden = readFileSync("contracts/accepted/phase1/conformance/valid-all-node-kinds.json", "utf8");
  const raw = await openRawCandidate(page);
  await raw.fill(golden);
  await page.getByRole("button", { name: "Apply candidate" }).click();
  await page.getByRole("tab", { name: "List editor" }).click();
  await page.locator(".node-list-row", { hasText: "execute" }).first().click();
  await page.getByLabel("execute Action proposal source source node").selectOption("decide");
  await expect(page.getByLabel("execute Action proposal source output")).toHaveValue("proposal");
  const digest = await validateAndReadDigest(page);
  expect(digest).not.toBe("not validated");

  await page.getByRole("tab", { name: "Canvas" }).click();
  const bundle = await readDownloadedBundle(page, () => page.getByRole("button", { name: "Export", exact: true }).click());
  const exported = JSON.parse(bundle);
  expect(exported.semantic.graphs[0].nodes.find((node: { id: string }) => node.id === "execute").config.proposal_from)
    .toEqual({ node_id: "decide", output: "proposal" });
  await page.setInputFiles('input[type="file"]', { name: "all-kinds.studio.json", mimeType: "application/json", buffer: Buffer.from(bundle) });
  await page.getByLabel("Imported bundle preview").getByRole("button", { name: "Apply imported bundle" }).click();
  expect(await validateAndReadDigest(page)).toBe(digest);
  expect(JSON.parse(await page.getByLabel("Raw workflow definition JSON").inputValue())
    .graphs[0].nodes.find((node: { id: string }) => node.id === "execute").config.proposal_from)
    .toEqual({ node_id: "decide", output: "proposal" });

  const rawAfterRoundTrip = page.getByLabel("Raw workflow definition JSON");
  await expect(rawAfterRoundTrip).toBeVisible();
  const stale = JSON.parse(await rawAfterRoundTrip.inputValue());
  const action = stale.graphs[0].nodes.find((node: { id: string }) => node.id === "execute");
  action.config.proposal_from = { node_id: "stale.node", output: "proposal" };
  await rawAfterRoundTrip.fill(JSON.stringify(stale));
  await page.getByRole("button", { name: "Apply candidate" }).click();
  await expect(page.locator(".validation-label")).toHaveText("Applied the bounded canonical JSON definition as a new semantic candidate.");
  await page.getByRole("tab", { name: "List editor" }).click();
  await page.locator(".node-list-row", { hasText: "execute" }).first().click();
  await expect(page.getByLabel("execute Action proposal source source node")).toHaveValue("stale.node");
  await expect(page.getByRole("alert")).toContainText(/missing or incompatible/i);
});
test("publishes adaptive region edits as a new revision and leaves the active run pinned", async ({ page }) => {
  await connectLiveOwner(page);
  await page.getByRole("button", { name: "Library", exact: true }).click();
  const card = page.locator(".definition-card").filter({ hasText: "sts2.combat.dynamic" });
  await expect(card).toHaveCount(1);
  await card.getByRole("button", { name: "Clone draft" }).click();
  await expect(page.getByText(/Loaded the owner-backed draft\.|Autosaved to the active adapter\./)).toBeVisible();

  await startLiveRun(page);
  await expect(page.getByRole("heading", { name: "Run inspector" })).toBeVisible();
  const runDigest = page.getByTestId("run-definition-digest");
  await expect(runDigest).not.toHaveText("");
  const pinnedDigest = (await runDigest.textContent()) ?? "";
  expect(pinnedDigest.length).toBeGreaterThan(8);

  await page.getByRole("button", { name: "Library", exact: true }).click();
  await page.locator(".definition-card").filter({ hasText: "sts2.combat.dynamic" }).getByRole("button", { name: "Open designer" }).click();
  await expect(page.getByText("Loaded the owner-backed draft.")).toBeVisible();
  await page.getByRole("tab", { name: "List editor" }).click();
  await page.locator(".node-list-row", { hasText: "iteration_adaptive" }).click();
  const inspector = page.getByLabel("Node inspector");
  await expect(inspector).toContainText("Authored region bounds are editable");
  const kindSelect = inspector.getByLabel("Node kind");
  await expect(kindSelect).toBeDisabled();
  await expect(inspector.locator("textarea")).toBeDisabled();
  await expect(inspector.getByRole("button", { name: "Remove node" })).toHaveCount(0);
  const replans = inspector.locator("label.field-label", { hasText: "Maximum replans" }).locator("input");
  await replans.fill("3");
  await replans.blur();
  await expect(page.getByText("Autosaved to the active adapter.")).toBeVisible();

  await page.getByRole("button", { name: /Validate/ }).click();
  await expect(page.locator(".validation-label")).toHaveText(/Validated at /);
  const revisedDigest = (await page.getByTestId("identity-definition-digest").textContent()) ?? "";
  expect(revisedDigest).not.toContain("not validated");
  expect(pinnedDigest.startsWith(revisedDigest.replace("…", "").slice(0, 12))).toBe(false);
  await page.getByRole("button", { name: "Publish revision" }).click();
  await expect(page.locator(".validation-label")).toHaveText(/Published an immutable owner revision\.|This exact semantic digest is already published\./);

  await page.getByRole("button", { name: "Runs", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Run inspector" })).toBeVisible();
  await expect(page.getByTestId("run-definition-digest")).toHaveText(pinnedDigest);
  await expect(page.getByText(/pinned to its admitted definition digest/)).toBeVisible();
  await expect(page.getByRole("button", { name: /Apply to active run|hot swap|Apply plan/i })).toHaveCount(0);
});
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
  await startLiveRun(page);
  await expect(page.getByRole("heading", { name: "Run inspector" })).toBeVisible();
  await expect(page.getByText("live API", { exact: true })).toBeVisible();
  await expect(page.getByText(/Loaded \d+ retained event/)).toBeVisible();
  await page.getByRole("button", { name: "Library", exact: true }).click();
  await page.getByRole("button", { name: "Open designer" }).first().click();
  await expect(page.getByText("Loaded the owner-backed draft.")).toBeVisible();
  await page.getByRole("button", { name: /Validate/ }).click();
  await expect(page.locator(".validation-label")).toHaveText(/Validated at /);
  await page.getByRole("button", { name: "Publish revision" }).click();
  await page.waitForTimeout(1500);
  await expect(page.locator(".validation-label")).toHaveText(/Published an immutable owner revision\.|This exact semantic digest is already published\./);
  await page.getByRole("button", { name: "Library", exact: true }).click();
  await page.getByRole("button", { name: "Refresh library" }).click();
  await expect(page.getByText("published", { exact: true }).first()).toBeVisible();
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
  await expect(page.getByText(/Autosaved to the active adapter\.|The owner already stored this candidate/)).toBeVisible();
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

test("resolves a lost publication response through the original publication identity", async ({ page }) => {
  await connectLiveOwner(page);
  await openOwnedDraft(page);
  await page.getByRole("button", { name: /Validate/ }).click();
  await expect(page.locator(".validation-label")).toHaveText(/Validated at /);

  const publicationBodies: Array<Record<string, unknown>> = [];
  let dropped = false;
  await page.route("**/studio/drafts/**/publish", async (route) => {
    publicationBodies.push(JSON.parse(route.request().postData() ?? "{}") as Record<string, unknown>);
    if (!dropped) {
      dropped = true;
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      await route.abort("connectionreset");
      return;
    }
    await route.continue();
  });

  await page.getByRole("button", { name: "Publish revision" }).click();
  await expect(page.locator(".validation-label")).not.toHaveText(/Published an immutable owner revision|already published/);
  await expect(page.getByRole("button", { name: "Publish revision" })).toBeEnabled();
  expect(dropped).toBe(true);

  await page.getByRole("button", { name: "Publish revision" }).click();
  await expect(page.locator(".validation-label")).toHaveText(/Published an immutable owner revision|already published/);

  expect(publicationBodies.length).toBeGreaterThanOrEqual(2);
  const first = publicationBodies[0];
  const retry = publicationBodies[1];
  expect(first.client_mutation_id).toMatch(/^studio\.publish\./);
  expect(retry.client_mutation_id).toBe(first.client_mutation_id);
  expect(retry.expected_definition_digest).toBe(first.expected_definition_digest);
  expect(retry.expected_revision).toBe(first.expected_revision);
});

test("resolves a lost command response by the original command id", async ({ page }) => {
  await connectLiveOwner(page);
  await openOwnedDraft(page);
  await startLiveRun(page);
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

test("keeps historical cursor actions free of live runtime requests", async ({ page }) => {
  await connectLiveOwner(page);
  await openOwnedDraft(page);
  await startLiveRun(page);
  await expect(page.getByRole("heading", { name: "Run inspector" })).toBeVisible();
  const cursor = page.getByLabel("Historical cursor");
  await expect(cursor).toBeVisible();
  await expect(page.getByText(/send no runtime, provider, or game request/)).toBeVisible();
  await page.getByRole("button", { name: "Pause" }).click();
  await expect(page.locator(".command-outcome")).toContainText(/applied at revision|admitted but not applied|pending/);
  await expect.poll(async () => await page.locator(".event-row").count()).toBeGreaterThan(1);

  const mutations: string[] = [];
  page.on("request", (request) => { if (request.method() !== "GET") mutations.push(`${request.method()} ${request.url()}`); });

  await page.getByRole("button", { name: "Enter history" }).click();
  await expect(page.getByRole("button", { name: "Return to live" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Pause" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Cancel" })).toBeDisabled();
  const stepBack = page.getByRole("button", { name: "Step back" });
  await expect(stepBack).toBeEnabled();
  await stepBack.click();
  await page.getByRole("button", { name: "Step forward" }).click();
  await page.getByLabel("Event cursor").press("Home");
  const setCursor = page.getByRole("button", { name: "Set cursor" }).first();
  if (await setCursor.count() > 0) await setCursor.click();
  await page.getByRole("button", { name: "Return to live" }).click();
  await expect(page.getByRole("button", { name: "Enter history" })).toBeVisible();

  expect(mutations).toEqual([]);
  await expect(page.getByRole("button", { name: /fresh game/i })).toHaveCount(0);
});

test("scopes crash recovery by principal and survives quota pressure", async ({ page }) => {
  await page.addInitScript(() => {
    const original = IDBObjectStore.prototype.put;
    let thrown = false;
    IDBObjectStore.prototype.put = function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
      if (!thrown) {
        thrown = true;
        throw new DOMException("simulated quota", "QuotaExceededError");
      }
      return original.call(this, value, key);
    };
  });
  await connectLiveOwner(page);
  await openOwnedDraft(page);
  const panel = page.getByLabel("Local crash recovery");
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("Tokens, live run snapshots, provider outputs and commands are never stored.");
  await panel.getByRole("button", { name: "Enable recovery" }).click();
  await applyLocalEdit(page, (local) => { (local as unknown as { annotations?: Record<string, unknown> }).annotations = { recovery_probe: "alpha" }; });
  await expect(panel).toContainText(/Stored records for this principal: 1/);
  await expect(panel).toContainText("Local recovery storage is full; older records were dropped.");

  const stored = await page.evaluate(async () => await new Promise<Record<string, unknown>[]>((resolve, reject) => {
    const open = indexedDB.open("ascension-studio-recovery", 1);
    open.onsuccess = () => {
      const database = open.result;
      const request = database.transaction("records", "readonly").objectStore("records").getAll();
      request.onsuccess = () => resolve(request.result as Record<string, unknown>[]);
      request.onerror = () => reject(request.error);
    };
    open.onerror = () => reject(open.error);
  }));
  expect(stored.length).toBeGreaterThan(0);
  expect(stored[0].principal).toBe("profile:studio-live");
  expect(JSON.stringify(stored)).not.toContain("studio-live-ci-token");
  for (const forbidden of ["command", "run_snapshot", "provider_output", "authorization"]) {
    expect(Object.keys(stored[0])).not.toContain(forbidden);
  }

  await page.getByRole("button", { name: "Open settings" }).click();
  await page.getByLabel("Authenticated actor subject").fill("profile:other");
  await page.getByRole("button", { name: "Check owner connection" }).click();
  await page.getByRole("button", { name: /Live owner API/ }).click();
  await page.getByRole("button", { name: "Library", exact: true }).click();
  await page.getByRole("button", { name: "Open designer" }).first().click();
  const switched = page.getByLabel("Local crash recovery");
  await expect(switched).toContainText("profile:other");
  await expect(switched).toContainText(/Stored records for this principal: 0/);
  await expect(switched.getByRole("button", { name: "Recover unsaved candidate" })).toBeDisabled();
});

test("reconciles the owner revision before retrying an offline save", async ({ page }) => {
  await connectLiveOwner(page);
  const definitionId = await openOwnedDraft(page);
  await page.route("**/v1/studio/drafts/**", async (route) => {
    const isRemoteMutation = (route.request().postData() ?? "").includes("studio.live-browser.offline-remote");
    if (route.request().method() === "PUT" && !isRemoteMutation) {
      await route.abort("failed");
      return;
    }
    await route.continue();
  });

  await applyLocalEdit(page, (local) => { local.version = "1.0.9"; });
  await expect(page.getByRole("button", { name: "Retry save" })).toBeVisible();

  const remote = await page.evaluate(async (id) => {
    const headers = { Authorization: "Bearer studio-live-ci-token", "Content-Type": "application/json" };
    const draftPath = `/v1/studio/drafts/draft.${id}`;
    const current = await (await fetch(draftPath, { headers })).json();
    const response = await fetch(draftPath, {
      method: "PUT",
      headers,
      body: JSON.stringify({
        schema_version: "ascension.studio-authoring/v1",
        expected_revision: current.revision,
        etag: current.etag,
        client_mutation_id: "studio.live-browser.offline-remote",
        document: current.document,
        layout: current.layout,
      }),
    });
    return { status: response.status, body: await response.json() };
  }, definitionId);
  expect(remote.status).toBe(200);

  await page.getByRole("button", { name: "Retry save" }).click();
  await expect(page.getByRole("heading", { name: "Local and remote drafts diverged" })).toBeVisible();
  await expect(page.getByText(/owner revision moved while this tab was offline/)).toBeVisible();
  await expect(page.getByLabel("Raw workflow definition JSON")).toHaveValue(/"version": "1.0.9"/);
});
