import { expect, test as setup } from "@playwright/test";
import { AUTH_FILE, E2E_PASSWORD } from "../playwright.config";

setup("log in as the owner", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Passwort", { exact: true }).fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Anmelden" }).click();
  await expect(page.getByRole("heading", { name: "Übersicht" })).toBeVisible();
  await page.context().storageState({ path: AUTH_FILE });
});
