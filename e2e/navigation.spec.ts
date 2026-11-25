import { expect, test, type Page, type Route } from "@playwright/test";

/**
 * Switching between the views feels like a native app: a view opened before is back at once with its data,
 * without a loading placeholder and without replaying its entrance; a change made in one view shows on another
 * one opened before. Both tests reuse the owner session from auth.setup.ts; that logging out empties the cache
 * is checked in app.spec.ts ("logout ends the session"), which signs in for itself.
 */

function nav(page: Page, name: string) {
  return page.getByRole("navigation", { name: "Hauptnavigation" }).getByRole("link", { name: new RegExp(`^${name}`) });
}

/**
 * For the next three seconds, records what looks like loading inside the view: a visible placeholder, or an
 * element of the view whose opacity or position motion animates (its inline style changes from frame to
 * frame). Static half-transparent marks do not count, nor does the cross-fade of the whole section, which is
 * the page transition.
 */
async function watchForLoading(page: Page) {
  await page.evaluate(() => {
    const seen: string[] = [];
    (window as unknown as { __loading: string[] }).__loading = seen;
    const last = new WeakMap<Element, string>();
    // The section on screen now fades out first (and already renders the next view while it does); only the
    // section that comes in counts.
    const leaving = document.querySelector("main > div");
    const until = performance.now() + 3000;
    const tick = () => {
      for (const el of document.querySelectorAll<HTMLElement>("main [aria-busy='true']")) {
        if (el.offsetParent !== null) seen.push(el.getAttribute("aria-label") ?? "placeholder");
      }
      const section = document.querySelector<HTMLElement>("main > div");
      const entering = section && section !== leaving ? section : null;
      for (const el of entering?.querySelectorAll<HTMLElement | SVGElement>("[style]") ?? []) {
        const now = `${el.style.opacity}|${el.style.transform}`;
        const before = last.get(el);
        if (before !== undefined && before !== now) seen.push(`entrance on ${el.tagName.toLowerCase()}`);
        last.set(el, now);
      }
      if (performance.now() < until) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

async function loadingSeen(page: Page) {
  return [...new Set(await page.evaluate(() => (window as unknown as { __loading: string[] }).__loading))];
}

const greeting = (page: Page) => page.getByText(/Mails in 7 Tagen\.$/);

test("a view opened before is back at once, without a placeholder and without replaying its entrance", async ({ page }) => {
  await page.goto("/");
  await expect(greeting(page)).toBeVisible();
  await nav(page, "Rechnungen").click();
  await expect(page.getByRole("heading", { name: "Rechnungen", level: 1 })).toBeVisible();
  await page.waitForTimeout(800);

  // Hold back the server's answers for the overview: the view must not wait for them.
  const slow = async (route: Route) => {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    await route.continue().catch(() => {});
  };
  await page.route("**/api/dashboard*", slow);
  await page.route("**/api/mails", slow);
  await watchForLoading(page);
  await nav(page, "Übersicht").click();
  await expect(greeting(page)).toBeVisible({ timeout: 1000 });
  await expect(page.getByRole("heading", { name: "Zu erledigen" })).toBeVisible({ timeout: 1000 });
  await page.waitForTimeout(800);
  expect(await loadingSeen(page)).toEqual([]);
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("a reply sent in the mailbox shows on the overview opened before, without loading it again", async ({ page }) => {
  await page.goto("/");
  const waiting = page.locator('main a[href="/freigabe"]').filter({ hasText: "Freigabe" }).locator(".tnum");
  await expect(waiting).toBeVisible();
  const before = Number(await waiting.textContent());

  await nav(page, "Posteingang").click();
  const list = page.getByRole("list", { name: "Freigabe", exact: true });
  await expect(list.getByRole("listitem").first()).toBeVisible();
  const rows = await list.getByRole("listitem").count();
  await page.getByRole("button", { name: "Senden", exact: true }).click();
  await expect(page.getByText("Antwort gesendet")).toBeVisible();
  await expect(list.getByRole("listitem")).toHaveCount(rows - 1);

  await watchForLoading(page);
  await nav(page, "Übersicht").click();
  await expect(waiting).toHaveText(String(before - 1));
  expect(await loadingSeen(page)).toEqual([]);
});
