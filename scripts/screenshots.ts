/**
 * Takes the README screenshots from a running server (headless Chromium): every view in light mode with the
 * neutral accent, the main views in dark mode, overview and mailbox (tab Freigabe) for every company accent, and
 * the phone layout. Waits for data, fonts and the entry animations before each shot.
 * Usage: SCREENSHOT_PASSWORD=<login password> npm run screenshots
 * Expects the seeded demo database (npm run seed -- --reset) on http://127.0.0.1:3220.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium, type BrowserContext, type Page } from "@playwright/test";
import { THEME_SLUGS } from "../web/src/theme";

const BASE = process.env.SCREENSHOT_BASE ?? "http://127.0.0.1:3220";
const PASSWORD = process.env.SCREENSHOT_PASSWORD;
const OUT = join(process.cwd(), "docs", "screenshots");
if (!PASSWORD) {
  console.error("Set SCREENSHOT_PASSWORD to the login password of the running server.");
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });

interface Item {
  id: string;
  subject: string;
}

/** Waits for data, fonts and the entrance animations (count-up and growing bars end after about a second). */
async function settle(page: Page) {
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1400);
}

async function shot(page: Page, name: string, fullPage = false) {
  await settle(page);
  await page.screenshot({ path: join(OUT, `${name}.png`), fullPage });
  console.log(`  ${name}.png`);
}

async function setMode(page: Page, mode: "light" | "dark") {
  await page.evaluate((m) => window.localStorage.setItem("inbox-assistant.mode", m), mode);
}

async function newContext(browser: Awaited<ReturnType<typeof chromium.launch>>, phone = false, storage?: Awaited<ReturnType<BrowserContext["storageState"]>>) {
  return browser.newContext({
    viewport: phone ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    deviceScaleFactor: phone ? 2 : 1,
    colorScheme: "light",
    locale: "de-DE",
    ...(storage ? { storageState: storage } : {}),
  });
}

const browser = await chromium.launch({ headless: true });
try {
  const ctx = await newContext(browser);
  const page = await ctx.newPage();
  const go = (url: string) => page.goto(`${BASE}${url}`);

  // ------------------------------------------------------------ login (no session)
  await go("/?firma=neutral");
  await setMode(page, "light");
  await go("/?firma=neutral");
  await shot(page, "desktop-01-login");
  await setMode(page, "dark");
  await page.reload();
  await shot(page, "dark-01-login");
  await setMode(page, "light");
  await page.reload();
  await page.getByLabel("Passwort", { exact: true }).fill(PASSWORD!);
  await page.getByRole("button", { name: "Anmelden" }).click();
  await page.getByRole("heading", { name: "Übersicht" }).waitFor();

  const mails = (await (await page.request.get(`${BASE}/api/mails`)).json()) as Item[];
  const bySubject = (s: string) => mails.find((m) => m.subject.includes(s))!.id;

  // ------------------------------------------------------------ desktop, light
  await shot(page, "desktop-00-uebersicht");
  await shot(page, "desktop-00a-uebersicht-ganz", true);
  const chart = page.getByRole("img", { name: "Mails pro Tag nach Art" });
  const tick = (await chart.locator("text", { hasText: /^Mo/ }).first().boundingBox())!;
  const box = (await chart.boundingBox())!;
  await page.mouse.move(tick.x + tick.width / 2, box.y + box.height * 0.6);
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(OUT, "desktop-00b-diagramm-tooltip.png") });
  console.log("  desktop-00b-diagramm-tooltip.png");
  await page.mouse.move(5, 5);

  await go("/freigabe");
  await shot(page, "desktop-02-freigabe");
  await go(`/freigabe/${bySubject("Wochenende")}`);
  await shot(page, "desktop-03-freigabe-hinweis");
  await go("/posteingang");
  await shot(page, "desktop-04-posteingang");
  await page.getByRole("button", { name: /Kategorie:/ }).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(OUT, "desktop-05-posteingang-filter.png") });
  console.log("  desktop-05-posteingang-filter.png");
  await page.keyboard.press("Escape");
  await go(`/pruefliste/${bySubject("L-88297")}`);
  await shot(page, "desktop-06-rechnung-falsche-summe");
  await go(`/pruefliste/${bySubject("Dringend")}`);
  await shot(page, "desktop-07-anweisung-im-mailtext");
  await go("/pruefliste");
  await shot(page, "desktop-08-pruefliste");
  await go("/rechnungen");
  await shot(page, "desktop-09-rechnungen");
  await go("/abgleich");
  await shot(page, "desktop-10-abgleich");
  await go("/woche");
  await shot(page, "desktop-11-woche");
  await go("/gibt-es-nicht");
  await shot(page, "desktop-12-seite-nicht-gefunden");
  await go("/freigabe");
  await settle(page);
  await page.getByRole("heading", { name: "Posteingang", exact: true }).click();
  await page.keyboard.press("?");
  await shot(page, "desktop-13-tastenkuerzel");
  await page.keyboard.press("Escape");

  // ------------------------------------------------------------ desktop, dark
  await setMode(page, "dark");
  await go("/");
  await shot(page, "dark-00-uebersicht");
  await go("/freigabe");
  await shot(page, "dark-02-freigabe");
  await go(`/pruefliste/${bySubject("L-88297")}`);
  await shot(page, "dark-06-rechnung-falsche-summe");
  await go("/rechnungen");
  await shot(page, "dark-09-rechnungen");
  await go("/abgleich");
  await shot(page, "dark-10-abgleich");
  await go("/woche");
  await shot(page, "dark-11-woche");
  await setMode(page, "light");

  // ------------------------------------------------------------ company accents
  for (const slug of THEME_SLUGS.filter((t) => t !== "neutral")) {
    await go(`/?firma=${slug}`);
    await shot(page, `theme-${slug}-uebersicht`);
    await go("/freigabe");
    await shot(page, `theme-${slug}-freigabe`);
    await setMode(page, "dark");
    await go("/");
    await shot(page, `theme-${slug}-dunkel`);
    await setMode(page, "light");
  }
  await go("/?firma=neutral");

  // ------------------------------------------------------------ phone
  const phone = await newContext(browser, true, await ctx.storageState());
  const m = await phone.newPage();
  const mgo = (url: string) => m.goto(`${BASE}${url}`);
  await mgo("/");
  await shot(m, "mobile-00-uebersicht");
  await mgo("/freigabe");
  await shot(m, "mobile-01-freigabe");
  await mgo(`/freigabe/${bySubject("Wohnzimmer")}`);
  await shot(m, "mobile-02-entwurf");
  await mgo("/posteingang");
  await shot(m, "mobile-03-posteingang");
  await mgo("/pruefliste");
  await shot(m, "mobile-04-pruefen");
  await mgo(`/mail/${bySubject("L-88297")}`);
  await shot(m, "mobile-05-rechnung");
  await mgo("/woche");
  await shot(m, "mobile-06-woche");
  await mgo("/abgleich");
  await shot(m, "mobile-07-abgleich");
  await phone.close();

  // ------------------------------------------------------------ reply on request (last: it adds a draft, then discards it)
  // The invoice with the wrong total: the reply quotes the numbers the code recomputed.
  await go(`/pruefliste/${bySubject("L-88297")}`);
  await page.getByRole("button", { name: "Antwort entwerfen" }).click();
  await page.getByLabel("Text").waitFor();
  // Wait for the "Entwurf bereit" toast to go, it would cover the text.
  await page.getByRole("status").filter({ hasText: "Entwurf bereit" }).waitFor({ state: "detached", timeout: 10_000 });
  await page.getByRole("region", { name: "Antwortentwurf" }).evaluate((el) => el.scrollIntoView({ block: "start" }));
  await shot(page, "desktop-14-antwort-entwerfen");
  // Discard it again, so the demo database looks as before.
  await page.getByRole("button", { name: "Verwerfen" }).click();
  const discarded = page.waitForResponse((r) => r.url().endsWith("/discard") && r.ok());
  await page.getByText("Es geht keine Antwort raus.").locator("..").getByRole("button", { name: "Verwerfen" }).click();
  await discarded;
  await ctx.close();
} finally {
  await browser.close();
}
