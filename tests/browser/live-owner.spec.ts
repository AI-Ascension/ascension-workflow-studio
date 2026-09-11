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
});
