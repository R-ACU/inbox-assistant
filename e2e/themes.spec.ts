import { expect, test, type Page } from "@playwright/test";
import { E2E_PASSWORD } from "../playwright.config";

/**
 * One test per theme and mode: the link parameter selects the accent, the stored choice the mode; every main view
 * renders with the self-hosted Allo font (no external request), and every visible text meets WCAG AA contrast
 * against the background it is actually drawn on (measured in the browser, not taken from the token list).
 */

const THEMES = [
  { slug: "neutral", company: null },
  { slug: "netzhandwerker", company: "Die Netzhandwerker" },
  { slug: "provipanda", company: "ProviPanda" },
  { slug: "wagemann", company: "Wagemann + Partner" },
  { slug: "elation", company: "Elation Health" },
] as const;
const MODES = ["light", "dark"] as const;

interface Low {
  text: string;
  ratio: number;
  need: number;
  fg: string;
  bg: string;
}

/** Contrast of every visible text node's element against its composited background. Colours are resolved by painting them on a canvas, so oklab and color-mix values work too. */
async function lowContrast(page: Page): Promise<Low[]> {
  return page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    const rgba = (css: string): [number, number, number, number] => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = "rgba(0,0,0,0)";
      ctx.fillStyle = css;
      ctx.fillRect(0, 0, 1, 1);
      const d = ctx.getImageData(0, 0, 1, 1).data;
      return [d[0]!, d[1]!, d[2]!, d[3]! / 255];
    };
    const over = (top: [number, number, number, number], under: [number, number, number]): [number, number, number] =>
      [0, 1, 2].map((i) => top[i]! * top[3] + under[i]! * (1 - top[3])) as [number, number, number];
    const lum = (c: [number, number, number]) =>
      c.map((v) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      }).reduce((acc, v, i) => acc + v * [0.2126, 0.7152, 0.0722][i]!, 0);
    const ratio = (a: [number, number, number], b: [number, number, number]) => {
      const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p) as [number, number];
      return (x + 0.05) / (y + 0.05);
    };
    /**
     * What is painted behind the text: the stack of elements under the middle of the text, from the text's own
     * element downwards (this also finds sliding selection marks, which are siblings, not ancestors). Falls back
     * to the ancestors when the text is outside the viewport.
     */
    const background = (el: Element): [number, number, number] => {
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      const inView = x >= 0 && y >= 0 && x < innerWidth && y < innerHeight;
      const stack = inView ? document.elementsFromPoint(x, y) : [];
      const start = stack.indexOf(el);
      const chain: Element[] = [];
      if (start >= 0) chain.push(...stack.slice(start));
      else for (let cur: Element | null = el; cur; cur = cur.parentElement) chain.push(cur);
      const layers: [number, number, number, number][] = [];
      for (const cur of chain) {
        const c = rgba(getComputedStyle(cur).backgroundColor);
        if (c[3] > 0) layers.push(c);
        if (c[3] >= 1) break;
      }
      let base: [number, number, number] = [255, 255, 255];
      for (const layer of layers.reverse()) base = over(layer, base);
      return base;
    };
    const out: Low[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const seen = new Set<Element>();
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const el = node.parentElement;
      if (!el || seen.has(el) || !node.textContent?.trim()) continue;
      seen.add(el);
      if (el.closest("[disabled], [aria-disabled='true'], [aria-hidden='true']")) continue;
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      if (r.width === 0 || r.height === 0 || s.visibility === "hidden" || Number(s.opacity) === 0) continue;
      const bg = background(el);
      const fg = over(rgba(s.color), bg);
      const size = parseFloat(s.fontSize);
      const large = size >= 24 || (size >= 18.66 && Number(s.fontWeight) >= 700);
      const need = large ? 3 : 4.5;
      const value = ratio(fg, bg);
      if (value < need) out.push({ text: node.textContent.trim().slice(0, 40), ratio: Math.round(value * 100) / 100, need, fg: fg.join(","), bg: bg.join(",") });
    }
    return out;
  });
}

async function expectAccessible(page: Page, view: string) {
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
  expect(await lowContrast(page), `contrast on ${view}`).toEqual([]);
}

for (const theme of THEMES) {
  for (const mode of MODES) {
    test(`theme ${theme.slug}, ${mode}: all views keep accent and mode, use Allo and reach AA contrast`, async ({ page }) => {
      const external: string[] = [];
      page.on("request", (r) => {
        if (!r.url().startsWith("http://127.0.0.1:")) external.push(r.url());
      });
      await page.addInitScript((m) => window.localStorage.setItem("inbox-assistant.mode", m), mode);

      await page.goto(`/?firma=${theme.slug}`);
      await expect(page.getByRole("heading", { name: "Übersicht" })).toBeVisible();
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme.slug);
      await expect(page.locator("html")).toHaveAttribute("data-mode", mode);
      const note = page.getByTestId("theme-note").first();
      if (theme.company) await expect(note).toHaveText(`Demo für ${theme.company}`);
      else await expect(page.getByTestId("theme-note")).toHaveCount(0);

      // The font is self-hosted and loads on first use; wait until Allo is there.
      await expect.poll(() => page.evaluate(() => [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family.replace(/"/g, ""))), { timeout: 10_000 }).toContain("Allo");
      const fonts = await page.evaluate(() => ({ h1: getComputedStyle(document.querySelector("h1")!).fontFamily, body: getComputedStyle(document.body).fontFamily }));
      expect(fonts.h1.startsWith("Allo")).toBe(true);
      expect(fonts.body.startsWith("Allo")).toBe(true);
      await expectAccessible(page, "Übersicht");

      // The theme stays without the parameter on every view.
      await page.goto("/freigabe");
      await expect(page.getByRole("heading", { name: "Posteingang", exact: true })).toBeVisible();
      await expectAccessible(page, "Freigabe");
      await page.getByRole("link", { name: /Streichen am Wochenende/ }).click();
      await expect(page.getByText(/Angabe ohne Quelle in FAQ oder Anfrage/)).toBeVisible();
      await expectAccessible(page, "Freigabe mit Prüfhinweis");
      await page.getByRole("button", { name: /^Quellen/ }).click();
      await expect(page.getByText("Wann können Sie anfangen?")).toBeVisible();
      await expectAccessible(page, "Freigabe mit aufgeklappten Quellen");

      await page.goto("/posteingang");
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme.slug);
      await page.getByRole("button", { name: /Kategorie:/ }).click();
      await expect(page.getByRole("listbox")).toBeVisible();
      await expectAccessible(page, "Posteingang mit offenem Dropdown");
      await page.keyboard.press("Escape");

      await page.goto("/pruefliste");
      await page.getByRole("link", { name: "Rechnung L-88297" }).click();
      await expect(page.getByRole("cell", { name: /^1\.170,00\s€$/ })).toBeVisible();
      await expect(page.getByRole("note", { name: "Prüfhinweis" })).toBeVisible();
      await expectAccessible(page, "Rechnung mit Prüfhinweis");

      await page.goto("/pruefliste");
      await page.getByRole("link", { name: /Dringend: offene Rechnung/ }).click();
      await expect(page.getByRole("region", { name: "Status" })).toContainText("Quarantäne");
      await expectAccessible(page, "Quarantäne");

      await page.goto("/abgleich");
      await expect(page.getByRole("group", { name: "Abweichungen" })).toBeVisible();
      await expectAccessible(page, "Abgleich");

      await page.goto("/rechnungen");
      await expect(page.getByText("Summe abgelegt").first()).toBeVisible();
      await expectAccessible(page, "Rechnungen");

      await page.goto("/woche");
      await expect(page.getByText(/KW \d+/).first()).toBeVisible();
      await expectAccessible(page, "Woche");

      await page.goto("/mail/0123456789abcdef0123");
      await expect(page.getByText(/gibt es nicht/)).toBeVisible();
      await expectAccessible(page, "Mail nicht gefunden");

      await page.goto("/gibt-es-nicht");
      await expect(page.getByText("Diese Seite gibt es nicht.")).toBeVisible();
      await expectAccessible(page, "404");

      await page.keyboard.press("?");
      await expect(page.getByRole("dialog", { name: "Tastenkürzel" })).toBeVisible();
      await expectAccessible(page, "Tastenkürzel");
      await page.keyboard.press("Escape");

      await page.route("**/api/mails*", (r) => r.fulfill({ status: 500, contentType: "application/json", body: '{"error":"Interner Fehler"}' }));
      await page.goto("/posteingang");
      await expect(page.getByText("Interner Fehler")).toBeVisible();
      await expectAccessible(page, "Fehlerzustand");
      await page.unroute("**/api/mails*");

      await page.goto("/posteingang");
      await page.getByRole("textbox", { name: "Mails durchsuchen" }).fill("xyzxyz");
      await expect(page.getByText("Keine Mail passt dazu.")).toBeVisible();
      await expectAccessible(page, "Leerzustand");

      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto("/");
      await expect(page.getByRole("heading", { name: "Übersicht" })).toBeVisible();
      await expectAccessible(page, "Übersicht mobil");
      await page.goto("/freigabe");
      await expect(page.getByRole("navigation", { name: "Schnellzugriff" }).getByRole("link")).toHaveCount(5);
      await expectAccessible(page, "Posteingang mobil");

      await page.context().clearCookies();
      await page.goto("/");
      await expect(page.getByLabel("Passwort", { exact: true })).toBeVisible();
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme.slug);
      await expectAccessible(page, "Login");

      expect(external, "requests to other hosts (fonts, CDNs)").toEqual([]);
    });
  }
}

test.describe("theme choice and login", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("the contrast check itself flags low contrast", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByLabel("Passwort", { exact: true })).toBeVisible();
    await page.evaluate(() => {
      const probe = document.createElement("p");
      probe.textContent = "Kontrastprobe";
      probe.style.color = "#b0b0b0";
      probe.style.background = "#ffffff";
      document.body.append(probe);
    });
    const low = await lowContrast(page);
    expect(low.map((l) => l.text)).toEqual(["Kontrastprobe"]);
  });

  test("the theme picked before the login stays after it, an unknown value gives neutral", async ({ page }) => {
    const dialogs: string[] = [];
    page.on("dialog", (d) => {
      dialogs.push(d.message());
      void d.dismiss();
    });
    await page.goto(`/?firma=${encodeURIComponent('"><img src=x onerror=alert(1)>')}`);
    await expect(page.getByLabel("Passwort", { exact: true })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "neutral");
    await expect(page.getByTestId("theme-note")).toHaveCount(0);
    expect(await page.locator('img[src="x"], img[onerror]').count()).toBe(0);

    await page.goto("/?firma=elation");
    await expect(page.getByTestId("theme-note").first()).toHaveText("Demo für Elation Health");
    await page.getByLabel("Passwort", { exact: true }).fill(E2E_PASSWORD);
    await page.getByRole("button", { name: "Anmelden" }).click();
    await expect(page.getByRole("heading", { name: "Übersicht" })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "elation");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "elation");
    await expect(page.getByTestId("theme-note").first()).toHaveText("Demo für Elation Health");
    expect(dialogs).toEqual([]);
  });
});
