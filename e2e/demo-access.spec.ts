import { expect, test } from "@playwright/test";
import { E2E_PASSWORD } from "../playwright.config";

/**
 * The public demo shows its password on the login page (PUBLIC_DEMO_PASSWORD, set for the e2e server as on
 * demo.remos.systems). One click signs in through the normal login route, so the server still checks the password.
 * This is one real sign-in: together with auth.setup and app.spec it stays under the limit of 5 per minute.
 */

test.use({ storageState: { cookies: [], origins: [] } });

test("the demo-access card shows the password and signs in with one click", async ({ page }) => {
  const sent: unknown[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/api/auth/login")) sent.push(request.postDataJSON());
  });
  await page.goto("/");

  const card = page.getByRole("region", { name: "Demo-Zugang" });
  await expect(card).toBeVisible();
  await expect(card).toContainText(E2E_PASSWORD);

  await card.getByRole("button", { name: "Demo öffnen" }).click();
  await expect(page.getByRole("heading", { name: "Übersicht", level: 1 })).toBeVisible();
  expect(sent).toEqual([{ password: E2E_PASSWORD }]);
});
