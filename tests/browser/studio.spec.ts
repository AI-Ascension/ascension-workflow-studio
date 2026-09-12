import { readFileSync } from "node:fs";

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
      ], guards: [{ id: "outcome.present", expression: { kind: "field", value: "approved.outcome" } }] }],
    };
    await page.goto("/");
    await page.getByRole("button", { name: "Open designer" }).first().click();
    await page.getByRole("button", { name: "JSON mode" }).click();
    await page.getByRole("textbox", { name: "Raw workflow definition JSON" }).fill(JSON.stringify(definition));
    await page.getByRole("button", { name: "Apply candidate" }).click();
    await expect(page.getByText(/Missing explicit exits: false/)).toBeVisible();
    await expect(page.getByLabel("outcome.present observation field")).toHaveValue("approved.outcome");
    const preview = page.getByTestId("guard-preview-result-outcome.present");
    await expect(preview).toHaveText("unknown");
    await expect(preview).toHaveAttribute("data-truth", "unknown");
    await page.getByLabel("outcome.present approved.outcome sample type").selectOption("boolean");
    await page.getByLabel("outcome.present approved.outcome sample value").selectOption("true");
    await expect(preview).toHaveText("true");
    await page.getByLabel("route branch 1 outcome").selectOption("false");
    await expect(page.getByLabel("route branch 1 target")).toHaveValue("completed");
    await page.getByRole("button", { name: "Move unknown branch earlier" }).click();
    await expect(page.getByLabel("route branch 1 outcome")).toHaveValue("unknown");
    await page.getByLabel("outcome.present observation field").fill("");
    await page.getByLabel("outcome.present observation field").blur();
    await expect(page.getByText("Select an approved observation field; missing data must remain unknown.")).toBeVisible();
    await page.getByLabel("route branch 2 target").selectOption("blocked");
    await expect(page.getByLabel("outcome.present observation field")).toHaveValue("");
  });

  test("resolves pinned subworkflow references and surfaces unavailable ones", async ({ page }) => {
    const definition = {
      schema_version: "ascension.workflow/v1", workflow_id: "reference.test", version: "1.0.0", mode: "strict", game_profile: "test", policy_ref: "test.policy",
      capabilities: { required: [], optional: [] }, limits: { max_steps: 4, max_subworkflow_depth: 2, max_provider_calls: 0, max_parallel_analyses: 1, max_output_tokens: 128 }, entry_graph: "main",
      graphs: [{ id: "main", entry_node: "start", nodes: [
        { id: "start", kind: "observe", config: { projection_ref: "approved.state" } },
        { id: "ref_ok", kind: "subworkflow", config: { artifact_ref: { id: "sts2.setup.strict", version: "0.1.0", digest: "not-published" } } },
        { id: "ref_missing", kind: "subworkflow", config: { artifact_ref: { id: "sts2.missing.workflow", version: "9.9.9", digest: "none" } } },
        { id: "done", kind: "terminal", config: { outcome: "completed" } },
      ], edges: [
        { from: "start", to: "ref_ok", on: "ok", priority: 0 },
        { from: "ref_ok", to: "ref_missing", on: "ok", priority: 0 },
        { from: "ref_missing", to: "done", on: "ok", priority: 0 },
      ], guards: [] }],
    };
    await page.goto("/");
    await page.getByRole("button", { name: "Open designer" }).first().click();
    await page.getByRole("button", { name: "JSON mode" }).click();
    await page.getByRole("textbox", { name: "Raw workflow definition JSON" }).fill(JSON.stringify(definition));
    await page.getByRole("button", { name: "Apply candidate" }).click();
    await page.locator(".react-flow__node", { hasText: "ref_ok" }).click();
    const resolved = page.getByLabel("Pinned reference resolution");
    await expect(resolved).toHaveAttribute("data-status", "resolved");
    await expect(resolved).toContainText("0.1.0");
    await expect(resolved).toContainText("does not publish a digest");
    await page.locator(".react-flow__node", { hasText: "ref_missing" }).click();
    const unavailable = page.getByLabel("Pinned reference resolution");
    await expect(unavailable).toHaveAttribute("data-status", "unavailable");
    await expect(unavailable).toContainText("sts2.missing.workflow");
    await expect(unavailable).toContainText("not present in the loaded catalog");
    await expect(page.getByText("typed input/output bindings are not yet supported", { exact: false })).toBeVisible();
  });

  test("navigates nested graphs with breadcrumbs, edits bounded loop limits, and shows pinned subworkflows", async ({ page }) => {
    const definition = {
      schema_version: "ascension.workflow/v1", workflow_id: "nested.test", version: "1.0.0", mode: "strict", game_profile: "test", policy_ref: "test.policy",
      capabilities: { required: [], optional: [] }, limits: { max_steps: 8, max_subworkflow_depth: 2, max_provider_calls: 0, max_parallel_analyses: 1, max_output_tokens: 128 }, entry_graph: "main",
      graphs: [
        { id: "main", entry_node: "start", nodes: [
          { id: "start", kind: "observe", config: { projection_ref: "approved.state" } },
          { id: "iterate", kind: "loop", config: { body_graph: "main.iteration", max_iterations: 4, exit_guard_ref: "guard.stop" } },
          { id: "call_library", kind: "subworkflow", config: { artifact_ref: { id: "sts2.shared.reward", version: "2.1.0", digest: "abc123def456abc123def456abc123def456abc123def456abc123def456abcd" } } },
          { id: "done", kind: "terminal", config: { outcome: "completed" } },
        ], edges: [
          { from: "start", to: "iterate", on: "ok", priority: 0 },
          { from: "iterate", to: "call_library", on: "true", priority: 0 },
          { from: "call_library", to: "done", on: "ok", priority: 0 },
        ], guards: [] },
        { id: "main.iteration", entry_node: "step", nodes: [
          { id: "step", kind: "observe", config: { projection_ref: "approved.iteration" } },
          { id: "again", kind: "route", config: { selector_ref: "approved.iteration.done" } },
        ], edges: [{ from: "step", to: "again", on: "ok", priority: 0 }], guards: [] },
      ],
    };
    await page.goto("/");
    await page.getByRole("button", { name: "Open designer" }).first().click();
    await page.getByRole("button", { name: "JSON mode" }).click();
    await page.getByRole("textbox", { name: "Raw workflow definition JSON" }).fill(JSON.stringify(definition));
    await page.getByRole("button", { name: "Apply candidate" }).click();
    const nav = page.getByRole("navigation", { name: "Workflow graph navigation" });
    await expect(nav).toBeVisible();
    await expect(nav).toContainText("not execution ordering or parallelism");
    await expect(page.locator(".react-flow__node")).toHaveCount(4);
    await page.locator(".react-flow__node", { hasText: "iterate" }).click();
    await page.getByRole("button", { name: "Open body graph: main.iteration" }).click();
    await expect(nav.locator(".graph-crumb-current")).toHaveText("main.iteration");
    await expect(page.locator(".react-flow__node")).toHaveCount(2);
    await expect(page.locator(".react-flow__node", { hasText: "step" })).toBeVisible();
    await nav.locator(".graph-crumb").first().click();
    await expect(nav.locator(".graph-crumb-current")).toHaveText("main");
    await expect(page.locator(".react-flow__node")).toHaveCount(4);
    const iterations = page.locator("label.field-label", { hasText: "Maximum iterations" }).locator("input");
    await iterations.fill("9");
    await iterations.blur();
    await expect(page.getByLabel("Raw workflow definition JSON")).toHaveValue(/"max_iterations": 9/);
    await page.locator(".react-flow__node", { hasText: "call_library" }).click();
    const pinned = page.getByLabel("Pinned subworkflow reference");
    await expect(pinned).toContainText("v2.1.0");
    await expect(pinned).toContainText("abc123def456");
    await page.getByRole("button", { name: "Inspect reference" }).click();
    await expect(page.getByText(/intentional fork or a new version/)).toBeVisible();
    await expect(page.getByText(/parallel execution/)).toHaveCount(0);
  });

  test("round-trips supported gameplay templates with capability gates", async ({ page }) => {
    const templates = [
      { id: "sts2.campaign.strict", capability: "authority.generation-fence.v1" },
      { id: "sts2.combat.dynamic", capability: "actions.combat.v1" },
      { id: "sts2.selection.strict", capability: "actions.selection.v1" },
      { id: "sts2.map.dynamic", capability: "actions.map.v1" },
    ];
    for (const template of templates) {
      await page.goto("/");
      const card = page.locator(".definition-card").filter({ hasText: template.id });
      await expect(card).toHaveCount(1);
      await expect(card).toHaveAttribute("data-capabilities", new RegExp(template.capability));
      await expect(card.locator(".capability-chip").first()).toBeVisible();
      await card.getByRole("button", { name: "Open designer" }).click();
      await expect(page.locator(".lede code")).toContainText(template.id);
      await page.getByRole("button", { name: /Validate/ }).click();
      await expect(page.locator(".validation-label")).toHaveText(/Validated at /);
      const [download] = await Promise.all([
        page.waitForEvent("download"),
        page.getByRole("button", { name: "Export", exact: true }).click(),
      ]);
      const path = await download.path();
      expect(path).not.toBeNull();
      await page.setInputFiles('input[type="file"]', path as string);
      const preview = page.getByLabel("Imported bundle preview");
      await expect(preview).toBeVisible();
      await expect(preview).toContainText(template.id);
      await expect(preview).toContainText("No semantic differences from the current document.");
      await preview.getByRole("button", { name: "Apply imported bundle" }).click();
      await expect(page.locator(".validation-label")).toHaveText(/Imported and verified a digest-bound Studio bundle\.|Autosaved to the active adapter\./);
      await expect(page.locator(".lede code")).toContainText(template.id);
    }
    await page.goto("/");
    const selection = page.locator(".definition-card").filter({ hasText: "sts2.selection.strict" });
    await expect(selection).not.toHaveAttribute("data-capabilities", /actions\.combat\.v1/);
  });

  test("resolves reference links only through approved mappings", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Open settings" }).click();
    const mappings = page.getByLabel("Approved reference mappings");
    await expect(mappings).toContainText("No approved mappings configured.");
    await mappings.getByLabel("Mapping template").fill("http://obs.example/traces/{trace_id}");
    await mappings.getByRole("button", { name: "Add mapping" }).click();
    await expect(mappings.getByText(/Approved links must use https/)).toBeVisible();
    await mappings.getByLabel("Mapping kind").selectOption("run");
    await mappings.getByLabel("Mapping label").fill("Obs run view");
    await mappings.getByLabel("Mapping template").fill("https://obs.example/runs/{run_id}");
    await mappings.getByRole("button", { name: "Add mapping" }).click();
    await expect(mappings).toContainText("Obs run view");

    await page.getByRole("button", { name: "Runs", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Run inspector" })).toBeVisible();
    const links = page.getByLabel("Approved reference links");
    await expect(links.getByRole("link", { name: "Obs run view" })).toHaveAttribute("href", "https://obs.example/runs/run.fixture.1");

    await links.getByLabel("Reference identifier probe").fill("https://evil.example/redirect");
    await expect(links.getByText(/Raw URLs are not resolved/)).toBeVisible();
    await expect(links.locator("a[href*='evil.example']")).toHaveCount(0);
    await links.getByLabel("Reference identifier probe").fill("//evil.example/x");
    await expect(links.getByText(/Raw URLs are not resolved/)).toBeVisible();
  });

  test("previews an imported bundle with named differences and can cancel it", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Open designer" }).first().click();
    await page.getByRole("button", { name: "JSON mode" }).click();
    const raw = page.getByLabel("Raw workflow definition JSON");

    const candidate = JSON.parse(await raw.inputValue()) as { version: string };
    candidate.version = "1.0.1";
    await raw.fill(JSON.stringify(candidate, null, 2));
    await page.getByRole("button", { name: "Apply candidate" }).click();
    await page.getByRole("button", { name: /Validate/ }).click();
    await expect(page.locator(".validation-label")).toHaveText(/Validated at /);
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export", exact: true }).click()]);
    const path = await download.path();
    expect(path).not.toBeNull();

    const newer = JSON.parse(await raw.inputValue()) as { version: string };
    newer.version = "1.0.2";
    await raw.fill(JSON.stringify(newer, null, 2));
    await page.getByRole("button", { name: "Apply candidate" }).click();

    await page.setInputFiles('input[type="file"]', path as string);
    const preview = page.getByLabel("Imported bundle preview");
    await expect(preview).toBeVisible();
    await expect(preview).toContainText("$.version");
    await expect(preview).toContainText("Required capabilities");
    await preview.getByRole("button", { name: "Cancel import" }).click();
    await expect(preview).not.toBeVisible();
    await expect(page.locator(".validation-label")).toHaveText("Bundle import cancelled; the current document is unchanged.");
    await expect(page.getByLabel("Raw workflow definition JSON")).toHaveValue(/"version": "1.0.2"/);
  });


  test("shows an admitted map projection separately and never as navigation", async ({ page }) => {
    const golden = JSON.parse(readFileSync("contracts/accepted/phase1/map/visible-map.golden.json", "utf8")) as Record<string, unknown>;
    await page.goto("/");
    await page.getByRole("button", { name: "Runs", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Run inspector" })).toBeVisible();
    const map = page.getByLabel("Gameplay map projection");
    await expect(map).toContainText("different graph from the workflow");
    await expect(map).toContainText("No approved map projection is loaded.");
    await expect(map.getByText(/Authoring and generic run inspection are unaffected/)).toBeVisible();

    await map.getByLabel("Map projection file").setInputFiles("contracts/accepted/phase1/map/visible-map.golden.json");
    await expect(map.locator(".status-badge").first()).toHaveText("available");
    await expect(map).toContainText("visible-map-v1");
    await expect(map).toContainText("runtime-map-v1");
    await expect(map).toContainText("map-instance-1");
    await expect(map).toContainText("4 nodes · 4 edges");
    await expect(map).toContainText("2 host navigation bindings pinned; none are exposed as actions.");
    await expect(map.locator(".map-node-list button")).toHaveCount(0);
    await expect(map.getByRole("button", { name: /select|navigate|move/i })).toHaveCount(0);

    await map.getByLabel("Map projection file").setInputFiles({ name: "stale.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ ...golden, freshness: "historical", reason: "captured earlier" })) });
    await expect(map.locator(".status-badge").first()).toHaveText("stale");
    await expect(map).toContainText("captured earlier");

    await map.getByLabel("Map projection file").setInputFiles({ name: "unavailable.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ ...golden, availability: "not_observable", reason: "map not visible" })) });
    await expect(map.locator(".status-badge").first()).toHaveText("unavailable");
    await expect(map).toContainText("map not visible");

    await map.getByLabel("Map projection file").setInputFiles({ name: "malformed.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ ...golden, nodes: [{ id: "bad" }] })) });
    await expect(map.getByRole("alert")).toBeVisible();
    await expect(map).toContainText("No approved map projection is loaded.");
  });

  test("browses and clones a template with pinned provenance", async ({ page }) => {
    await page.goto("/");
    const card = page.locator(".definition-card").first();
    const provenance = card.getByLabel("sts2.setup.strict provenance");
    await expect(provenance).toContainText("v0.1.0");
    await expect(provenance).toContainText("not published");
    await card.getByRole("button", { name: "Clone draft" }).click();
    await page.getByRole("button", { name: "JSON mode" }).click();
    const raw = page.getByLabel("Raw workflow definition JSON");
    await expect(raw).toHaveValue(/"summary": "Studio draft cloned from catalog:sts2.setup.strict@0.1.0"/);
  });

  test("keeps core Studio functions working when optional integrations are absent", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      const text = message.text();
      // A third-party validator bundles a runtime `eval` call that the strict
      // production CSP blocks (Firefox reports it as a console error). It is a
      // known dependency limitation, not an optional-integration failure.
      const cspEvalNotice = text.includes("Content-Security-Policy") && text.includes("eval");
      if (message.type() === "error" && !text.includes("frame-ancestors") && !cspEvalNotice) errors.push(text);
    });

    await page.goto("/");
    await expect(page.locator(".definition-card").first()).toBeVisible();

    await page.getByRole("button", { name: "Open designer" }).first().click();
    await page.getByRole("tab", { name: "List editor" }).click();
    await page.locator(".node-list-row").first().click();
    const inspector = page.getByLabel("Node inspector");
    const projection = inspector.locator("label.field-label", { hasText: "Projection reference" }).locator("input");
    await projection.fill("approved.state.changed");
    await projection.blur();
    await expect(inspector).toContainText("owner field");

    await page.getByRole("button", { name: /Validate/ }).click();
    await expect(page.locator(".validation-label")).toHaveText(/Validated at /);
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export", exact: true }).click()]);
    expect(download.suggestedFilename()).toContain(".studio.json");
    const path = await download.path();
    expect(path).not.toBeNull();
    await page.setInputFiles('input[type="file"]', path as string);
    await expect(page.getByLabel("Imported bundle preview")).toBeVisible();
    await page.getByLabel("Imported bundle preview").getByRole("button", { name: "Cancel import" }).click();

    await page.getByRole("button", { name: "Runs", exact: true }).click();
    await expect(page.getByLabel("Gameplay map projection")).toContainText("No approved map projection is loaded.");
    await expect(page.getByLabel("Approved reference links")).toContainText("No approved mappings configured in settings.");

    await page.getByRole("button", { name: "Open settings" }).click();
    await expect(page.getByLabel("Approved reference mappings")).toContainText("No approved mappings configured.");
    await page.getByRole("button", { name: "Replay / Compare", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Replay & compare" })).toBeVisible();

    expect(errors).toEqual([]);
  });

  test("compares runs by pinned context without causal overclaims", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Replay / Compare", exact: true }).click();
    await page.getByRole("button", { name: "Replay & compare" }).click();
    const context = page.getByLabel("Run context comparison");
    await expect(context).toBeVisible();
    await expect(context).toContainText("Primary run");
    await expect(context).toContainText("Secondary run");
    await expect(context).toContainText(/revision \d+/);
    await expect(context).toContainText("not causal proof");
    await expect(page.getByText(/improved gameplay|caused the|because of the edit/i)).toHaveCount(0);
  });

  test("supports narrow viewports, reduced motion, zoom and light/dark themes", async ({ page }) => {
    await page.setViewportSize({ width: 480, height: 900 });
    await page.goto("/");
    await expect(page.locator(".definition-card").first()).toBeVisible();
    const libraryOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(libraryOverflow).toBeLessThanOrEqual(2);

    await page.getByRole("button", { name: "Open designer" }).first().click();
    await expect(page.locator(".designer-body")).toBeVisible();
    const designerOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(designerOverflow).toBeLessThanOrEqual(2);

    await page.emulateMedia({ reducedMotion: "reduce" });
    const duration = await page.locator(".button").first().evaluate((element) => getComputedStyle(element).transitionDuration);
    expect(Number.parseFloat(duration)).toBeLessThan(0.01);

    await page.emulateMedia({ colorScheme: "dark" });
    const darkBackground = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--bg").trim());
    await page.emulateMedia({ colorScheme: "light" });
    const lightBackground = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--bg").trim());
    expect(lightBackground).not.toBe(darkBackground);
    expect(lightBackground.length).toBeGreaterThan(0);

    await page.evaluate(() => { document.documentElement.style.zoom = "1.5"; });
    const zoomOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(zoomOverflow).toBeLessThanOrEqual(4);
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
