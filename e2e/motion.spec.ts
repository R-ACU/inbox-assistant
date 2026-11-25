import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * Regression tests for motion that went wrong in real use:
 * - Fast back and forward between the mailbox tabs left the rows that came back at height 0 and shifted to
 *   the left, so the whole list lay on top of itself (a row can come back before it has left the DOM).
 * - The share in "Ohne Nacharbeit" counted up from 0 again after every hover, and the overview counted
 *   again every time one came back to it. Numbers count up once, when they first appear.
 */

interface RowBox {
  top: number;
  height: number;
}

const rowBoxes = (page: Page): Promise<RowBox[]> =>
  page.locator("main li[data-row]").evaluateAll((lis) =>
    lis.map((li) => {
      const b = li.getBoundingClientRect();
      return { top: Math.round(b.top * 10) / 10, height: Math.round(b.height * 10) / 10 };
    }),
  );

/** Waits until the rows stop moving, then checks the count, that every row has its full height and that none overlaps the one above. */
async function expectTidyList(page: Page, rows: number, when: string) {
  await expect
    .poll(
      async () => {
        const a = await rowBoxes(page);
        await page.waitForTimeout(150);
        return a.length > 0 && JSON.stringify(a) === JSON.stringify(await rowBoxes(page));
      },
      { message: `${when}: the list settles`, timeout: 8000 },
    )
    .toBe(true);
  const boxes = await rowBoxes(page);
  expect(boxes, `${when}: rows in the list`).toHaveLength(rows);
  boxes.forEach((r, i) => {
    expect(r.height, `${when}: height of row ${i + 1}`).toBeGreaterThan(40);
    if (i > 0) expect(r.top, `${when}: row ${i + 1} overlaps the row above`).toBeGreaterThanOrEqual(boxes[i - 1]!.top + boxes[i - 1]!.height - 0.5);
  });
}

test("fast back and forward between the mailbox tabs never piles the rows on top of each other", async ({ page }) => {
  const mails = (await (await page.request.get("/api/mails")).json()) as { status: string }[];
  const all = mails.length;
  const review = mails.filter((m) => ["needs_review", "quarantined", "delivery_failed"].includes(m.status)).length;
  expect(all - review, "rows that leave the list when switching to Prüfen").toBeGreaterThan(3);

  await page.goto("/posteingang");
  await expectTidyList(page, all, "Alle");

  // The moment that broke: the rows that left for "Prüfen" have finished folding away but are still in the
  // DOM when the browser goes back. motion writes exactly 0px only when the exit animation has ended; the
  // rows stay in the DOM for a few frames after that. Waiting and going back happen in the page, in the
  // same frame, so the test hits that window every time.
  await page.getByRole("tab", { name: /Prüfen/ }).click();
  const stillThere = await page.evaluate(async () => {
    const folded = () => [...document.querySelectorAll<HTMLElement>("main li[data-row]")].some((li) => li.style.height === "0px");
    while (!folded()) await new Promise(requestAnimationFrame);
    history.back();
    return document.querySelectorAll("main li[data-row]").length;
  });
  expect(stillThere, "the folded rows were still in the list when the browser went back").toBe(all);
  await expect(page).toHaveURL(/\/posteingang$/);
  await expectTidyList(page, all, "back to Alle right after the rows folded away");

  // Back and forward at other moments, the way one clicks the browser buttons in a hurry.
  for (const wait of [0, 90, 180, 260, 320, 400]) {
    await page.getByRole("tab", { name: /Prüfen/ }).click();
    await page.waitForTimeout(wait);
    await page.evaluate(() => history.back());
    await page.waitForTimeout(wait);
    await page.evaluate(() => history.forward());
    await page.waitForTimeout(wait);
    await page.evaluate(() => history.back());
    await expect(page).toHaveURL(/\/posteingang$/);
    await expectTidyList(page, all, `back, forward, back with ${wait} ms between`);
  }

  // A reload in between starts clean, and back still works afterwards.
  await page.getByRole("tab", { name: /Prüfen/ }).click();
  await page.reload();
  await expectTidyList(page, review, "Prüfen after a reload");
  await page.goBack();
  await expect(page).toHaveURL(/\/posteingang$/);
  await expectTidyList(page, all, "back to Alle after the reload");
});

/** Every text a number shows during the next `ms` milliseconds, one sample per frame. */
const shownDuring = (number: Locator, ms: number) =>
  number.evaluate(async (el, ms) => {
    const seen = new Set<string>();
    const end = performance.now() + ms;
    while (performance.now() < end) {
      // CountUp shows the moving value in the aria-hidden span; the hover value is plain text.
      seen.add((el.querySelector("[aria-hidden]") ?? el).textContent?.trim() ?? "");
      await new Promise(requestAnimationFrame);
    }
    return [...seen];
  }, ms);

test("numbers count up once: neither a hover nor coming back to the overview makes them count again", async ({ page }) => {
  await page.goto("/");
  const gauge = page.getByRole("img", { name: /ohne Nacharbeit$/ });
  await expect(gauge).toBeVisible();
  const final = (await gauge.getAttribute("aria-label"))!.replace(/ ohne Nacharbeit$/, "");
  const share = gauge.locator("p").first();
  await expect(share).toHaveText(new RegExp(`${final}$`));

  // Hover the accent part of the half ring (left side, where the share starts), then leave it again.
  const box = (await gauge.boundingBox())!;
  const r = (box.width / 2) * 0.86;
  await page.mouse.move(box.x + box.width / 2 + r * Math.cos((150 * Math.PI) / 180), box.y + box.height - 4 - r * Math.sin((150 * Math.PI) / 180));
  await expect(gauge.locator("p").nth(1)).toHaveText("ohne Nacharbeit");
  await page.mouse.move(box.x + box.width / 2, box.y - 120);
  await expect(gauge.locator("p").nth(1)).not.toHaveText("ohne Nacharbeit");
  expect(await shownDuring(share, 700), "the share after the hover").toEqual([final]);

  // Away and back: the overview shows its numbers right away instead of counting again.
  // The rail sits in tooltips; its links must switch the view without loading the page again.
  const mailsApi = (await (await page.request.get("/api/dashboard?days=7")).json()) as { current: { mails: number } };
  await page.evaluate(() => ((window as unknown as { __samePage: boolean }).__samePage = true));
  await page.getByRole("navigation", { name: "Hauptnavigation" }).getByRole("link", { name: /Rechnungen/ }).click();
  await expect(page.getByRole("heading", { name: "Rechnungen", exact: true })).toBeVisible();
  await page.goBack();
  expect(await page.evaluate(() => (window as unknown as { __samePage?: boolean }).__samePage), "the page was not reloaded").toBe(true);
  // The big count in the hero is the one CountUp there (a .tnum with a screen-reader copy of the value).
  const mails = page.getByRole("region", { name: "Eingang" }).locator("span.tnum:has(> .sr-only)");
  await expect(mails).toBeVisible();
  expect(await shownDuring(mails, 700), "the mail count after coming back").toEqual([String(mailsApi.current.mails)]);
});
