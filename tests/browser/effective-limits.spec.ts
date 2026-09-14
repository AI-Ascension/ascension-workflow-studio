import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

const vectors = JSON.parse(readFileSync("contracts/accepted/effective-limits/producer.json", "utf8"));
const productionCsp = readFileSync("index.html", "utf8").match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1] ?? "";

for (const variant of ["v3", "v1", "tampered", "stale", "missing", "association-failure"] as const) {
  test(`synthetic authenticated capability boundary: ${variant}`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    let rejectAssociation = false;
    await page.route("**/synthetic/context-association", (route) =>
      route.fulfill({ status: rejectAssociation ? 503 : 200, json: {} }));
    const memory = structuredClone(vectors.memory[1].descriptor);
    const session = structuredClone(vectors.session[1].descriptor);
    if (variant === "v1") {
      memory.schema = "ascension.context-memory.capabilities.v1";
      session.schema = "ascension.provider-session.capabilities.v1";
      for (const value of [memory, session]) {
        delete value.binding;
        delete value.effective_limits;
      }
      session.enabled_methods = ["initialize"];
      session.hardening.encrypted_state = true;
    } else if (variant === "tampered") {
      memory.effective_limits.optional_byte_budget += 1;
      session.effective_limits.max_prepared_bytes += 1;
    } else if (variant === "stale") {
      memory.binding.policy_schema_sha256 = "0".repeat(64);
      session.binding.policy_schema_sha256 = "0".repeat(64);
    } else if (variant === "missing") {
      delete memory.effective_limits;
      delete session.effective_limits;
    }
    const requests: string[] = [];
    await page.route("**/api/context/**", async (route) => {
      expect(route.request().method()).toBe("GET");
      expect(route.request().headers().authorization).toBe("Bearer synthetic-capability-token");
      const path = new URL(route.request().url()).pathname;
      requests.push(path);
      if (path.endsWith("/memory/capabilities")) {
        await route.fulfill({ json: memory });
      } else if (path === "/api/context/v1/runs/fixture-run/provider-sessions/capabilities") {
        await route.fulfill({ json: {
          schema: "ascension.provider-session.api-result.v1", operation: "capabilities", value: session,
          effect_class: "local_metadata_only", inference_calls: 0, game_effects: 0,
        } });
      } else await route.fulfill({ status: 503, json: { error: "synthetic unrelated projection unavailable" } });
    });
    await page.goto("/tests/fixtures/effective-limits.html");
    expect(errors).toEqual([]);
    await expect(page.locator('meta[http-equiv="Content-Security-Policy"]')).toHaveAttribute("content", productionCsp);
    const memoryPanel = page.getByRole("region", { name: "Memory evidence" });
    const sessionPanel = page.getByRole("region", { name: "Provider session evidence" });
    if (variant === "v3" || variant === "association-failure") {
      await expect(memoryPanel).toContainText(`Owner effective optional_byte_budget: ${memory.effective_limits.optional_byte_budget} bytes`);
      await expect(sessionPanel).toContainText(`Owner effective max_prepared_bytes: ${session.effective_limits.max_prepared_bytes} bytes`);
      await expect(sessionPanel).toContainText("Private retention requires owner approval and authenticated encryption.");
      if (variant === "association-failure") {
        rejectAssociation = true;
        await page.getByRole("button", { name: "Refresh", exact: true }).click();
        await expect(memoryPanel).toContainText("current owner association is unavailable");
        await expect(sessionPanel).toContainText("current owner association is unavailable");
        await expect(memoryPanel).not.toContainText("Owner effective");
        await expect(memoryPanel).not.toContainText("memory search is available");
        await expect(sessionPanel).not.toContainText("Owner effective");
      }
    } else if (variant === "missing") {
      await expect(memoryPanel).toContainText("Memory projection is unavailable from the composed context owner.");
      await expect(sessionPanel).toContainText("Effective input limits unavailable from the composed context owner.");
    } else {
      const reason = variant === "v1" ? "field_not_advertised" : variant === "stale" ? "descriptor_stale" : "descriptor_tampered";
      await expect(memoryPanel).toContainText(`Effective input limits unavailable (${reason})`);
      await expect(sessionPanel).toContainText(`Effective input limits unavailable (${reason})`);
      await expect(memoryPanel).not.toContainText("Owner effective");
      await expect(sessionPanel).not.toContainText("Owner effective");
      if (variant !== "v1") await expect(memoryPanel).not.toContainText("memory search is available");
    }
    expect(requests).toContain("/api/context/v1/runs/fixture-run/provider-sessions/capabilities");
    expect(requests.some((path) => path.includes("workflow-fixture"))).toBe(false);
    await expect(page.locator("body")).not.toContainText("synthetic-capability-token");
    expect(await page.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage } })))
      .toEqual({ local: {}, session: {} });
  });
}
