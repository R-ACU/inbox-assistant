/**
 * Theme selection and theme tokens.
 * 1. Only the fixed list of themes can be selected; anything else falls back to neutral, and the raw input
 *    never reaches the DOM (only the known key is written to data-theme).
 * 2. styles.css defines every base token per mode (light, dark) and every accent token per company and mode,
 *    and all colour pairs the UI draws meet WCAG AA contrast.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { THEME_SLUGS, THEME_STORAGE_KEY, applyTheme, companyOf, pickTheme, resolveMode, resolveTheme } from "../web/src/theme";

const HOSTILE = [
  "",
  " ",
  "unknown",
  "netzhandwerker2",
  "net zhandwerker",
  '"><script>alert(1)</script>',
  "neutral;} html{background:red}",
  "wagemann\" onload=\"x",
  "elation</style>",
  "__proto__",
  "constructor",
  "toString",
  "hasOwnProperty",
  "provipanda".repeat(10),
  "netzhandwerker\u0000",
  "ｎｅｔｚｈａｎｄｗｅｒｋｅｒ",
  "url(javascript:alert(1))",
];

describe("theme selection", () => {
  it("accepts exactly the five known slugs", () => {
    expect(THEME_SLUGS).toEqual(["neutral", "netzhandwerker", "provipanda", "wagemann", "elation"]);
    for (const slug of THEME_SLUGS) expect(resolveTheme(slug)).toBe(slug);
  });

  it("is lenient only about case and surrounding blanks", () => {
    expect(resolveTheme(" Wagemann ")).toBe("wagemann");
    expect(resolveTheme("ELATION")).toBe("elation");
  });

  it.each(HOSTILE)("falls back to neutral for %j", (value) => {
    expect(resolveTheme(value)).toBe("neutral");
  });

  it("falls back to neutral for values that are not strings", () => {
    for (const value of [null, undefined, 42, {}, ["wagemann"], { toString: () => "wagemann" }]) expect(resolveTheme(value)).toBe("neutral");
  });

  it("lets the URL parameter win over the stored choice, also when it is invalid", () => {
    expect(pickTheme("?firma=elation", "wagemann")).toBe("elation");
    expect(pickTheme("?firma=%3Cscript%3E", "wagemann")).toBe("neutral");
    expect(pickTheme("?firma=", "wagemann")).toBe("neutral");
    expect(pickTheme("", "wagemann")).toBe("wagemann");
    expect(pickTheme("?other=1", "provipanda")).toBe("provipanda");
    expect(pickTheme("", "<img src=x>")).toBe("neutral");
    expect(pickTheme("", null)).toBe("neutral");
    // The first parameter counts, a second one cannot override it.
    expect(pickTheme("?firma=wagemann&firma=elation", null)).toBe("wagemann");
  });

  it("writes only a known key to the DOM and to storage", () => {
    for (const value of [...HOSTILE, ...THEME_SLUGS]) {
      const root = { dataset: {} as DOMStringMap };
      const store = new Map<string, string>();
      const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
      const slug = applyTheme(root, `?firma=${encodeURIComponent(value)}`, storage);
      expect(THEME_SLUGS).toContain(slug);
      expect(root.dataset.theme).toBe(slug);
      expect(store.get(THEME_STORAGE_KEY)).toBe(slug);
      expect(Object.keys(root.dataset)).toEqual(["theme"]);
    }
  });

  it("keeps the choice for the session: a later page view without parameter uses the stored theme", () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    applyTheme({ dataset: {} }, "?firma=netzhandwerker", storage);
    const root = { dataset: {} as DOMStringMap };
    expect(applyTheme(root, "", storage)).toBe("netzhandwerker");
    expect(root.dataset.theme).toBe("netzhandwerker");
  });

  it("still works when storage is blocked", () => {
    const storage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    const root = { dataset: {} as DOMStringMap };
    expect(applyTheme(root, "?firma=provipanda", storage)).toBe("provipanda");
    expect(applyTheme(root, "", null)).toBe("neutral");
  });

  it("shows a company name only from the fixed list", () => {
    expect(companyOf("neutral")).toBeNull();
    expect(THEME_SLUGS.filter((s) => s !== "neutral").map(companyOf)).toEqual(["Die Netzhandwerker", "ProviPanda", "Wagemann + Partner", "Elation Health"]);
  });
});

// ---------------------------------------------------------------- tokens and contrast

const css = readFileSync(join(process.cwd(), "web", "src", "styles.css"), "utf8");

/** Variables of the block whose selector is exactly `selector` (several blocks with the same selector are merged). */
function block(selector: string): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = m[1]!.replace(/\/\*[\s\S]*?\*\//g, "").split(";").at(-1)!.split(",").map((x) => x.trim());
    if (!selectors.includes(selector)) continue;
    for (const v of m[2]!.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) vars[v[1]!] = v[2]!.trim();
  }
  return vars;
}

const MODES = ["light", "dark"] as const;
const AVATAR_TOKENS = [1, 2, 3, 4, 5].flatMap((i) => [`avatar-${i}-bg`, `avatar-${i}-fg`]);
const BASE_TOKENS = ["bg", "surface", "surface-2", "hover", "track", "thumb", "line", "line-strong", "ink", "ink-2", "ink-3", "good", "good-soft", "bad", "bad-soft", "chart-3", "chart-4", "hatch", "hero", "hero-2", "hero-ink", "hero-ink-2", "hero-hatch", "glass", "glass-ink", "glass-ink-2", ...AVATAR_TOKENS];
const ACCENT_TOKENS = ["accent", "accent-hover", "accent-ink", "accent-soft", "accent-text", "chart-2", "accent-strong", "accent-strong-ink"];

function base(mode: (typeof MODES)[number]) {
  return { ...block(":root"), ...(mode === "dark" ? block(':root[data-mode="dark"]') : {}) };
}
function accent(slug: string, mode: (typeof MODES)[number]) {
  if (slug === "neutral") return mode === "dark" ? { ...block(":root"), ...block(':root[data-mode="dark"]') } : block(":root");
  return mode === "dark" ? block(`:root[data-theme="${slug}"][data-mode="dark"]`) : block(`:root[data-theme="${slug}"]`);
}

function hex(value: string): [number, number, number] {
  const m = /^#([0-9a-f]{6})$/i.exec(value);
  if (!m) throw new Error(`not a 6-digit hex colour: ${value}`);
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function luminance([r, g, b]: [number, number, number]) {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
function mix(a: [number, number, number], b: [number, number, number], share: number): [number, number, number] {
  return [0, 1, 2].map((i) => Math.round(a[i]! * share + b[i]! * (1 - share))) as [number, number, number];
}
function contrast(fg: [number, number, number], bg: [number, number, number]) {
  const [l1, l2] = [luminance(fg), luminance(bg)].sort((x, y) => y - x) as [number, number];
  return (l1 + 0.05) / (l2 + 0.05);
}

describe.each(MODES)("base tokens, %s mode", (mode) => {
  const t = base(mode);
  const c = (name: string) => hex(t[name]!);

  it("defines every base token as six-digit hex", () => {
    for (const k of BASE_TOKENS) expect(() => hex(t[k] ?? "missing"), `--${k}`).not.toThrow();
  });

  it("text meets 4.5:1 on every surface it is drawn on", () => {
    for (const fg of ["ink", "ink-2", "ink-3"]) for (const bg of ["bg", "surface", "surface-2", "hover"]) expect(contrast(c(fg), c(bg)), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
    for (const fg of ["hero-ink", "hero-ink-2"]) for (const bg of ["hero", "hero-2"]) expect(contrast(c(fg), c(bg)), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
  });

  it("text on the switch track and its thumb meets 4.5:1 (tabs, period switch)", () => {
    for (const fg of ["ink", "ink-2", "ink-3"]) for (const bg of ["track", "thumb"]) expect(contrast(c(fg), c(bg)), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
  });

  it("avatar initials meet 4.5:1 on their tint", () => {
    for (let i = 1; i <= 5; i++) expect(contrast(c(`avatar-${i}-fg`), c(`avatar-${i}-bg`)), `avatar ${i}`).toBeGreaterThanOrEqual(4.5);
  });

  it("status text meets 4.5:1 on surfaces and on its own soft tint", () => {
    for (const tone of ["good", "bad"]) {
      for (const bg of ["surface", "surface-2", `${tone}-soft`]) expect(contrast(c(tone), c(bg)), `${tone} on ${bg}`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(c("ink"), c(`${tone}-soft`)), `ink on ${tone}-soft`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(c("ink-2"), c(`${tone}-soft`)), `ink-2 on ${tone}-soft`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("chart marks and hatching stand out from their card (3:1 for marks)", () => {
    expect(contrast(c("chart-4"), c("surface")), "chart-4 on surface").toBeGreaterThanOrEqual(3);
    if (mode === "dark") {
      expect(contrast(c("chart-4"), c("hero")), "chart-4 on hero").toBeGreaterThanOrEqual(3);
      expect(contrast(c("chart-3"), c("hero")), "chart-3 on hero").toBeGreaterThanOrEqual(3);
    }
    expect(contrast(c("hatch"), c("surface")), "hatch on surface").toBeGreaterThanOrEqual(1.3);
    expect(contrast(c("hero-hatch"), c("hero")), "hero-hatch on hero").toBeGreaterThanOrEqual(1.3);
  });

  it("dark tokens also apply to any element marked data-mode=dark (the hero card)", () => {
    if (mode !== "dark") return;
    expect(css).toMatch(/:root\[data-mode="dark"\],\s*\[data-mode="dark"\] \{/);
    for (const slug of THEME_SLUGS.filter((x) => x !== "neutral")) expect(css).toContain(`:root[data-theme="${slug}"] [data-mode="dark"] {`);
  });

  it("the dark mode is a neutral black or anthracite, not a blue-tinted one", () => {
    if (mode !== "dark") return;
    for (const k of ["bg", "surface", "surface-2"]) {
      const [r, g, b] = c(k);
      expect(Math.max(r, g, b) - Math.min(r, g, b), `--${k} is neutral`).toBeLessThanOrEqual(4);
    }
  });

  it("text on the frosted login panel meets 4.5:1 over the darkest and the lightest part of the photo", () => {
    const share = Number(t["glass-alpha"]);
    expect(share).toBeGreaterThanOrEqual(0.78);
    for (const under of [[0, 0, 0], [255, 255, 255]] as [number, number, number][]) {
      const bg = mix(c("glass"), under, share);
      for (const fg of ["glass-ink", "glass-ink-2"]) expect(contrast(c(fg), bg), `${fg} over ${under}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe.each(THEME_SLUGS.flatMap((slug) => MODES.map((mode) => [slug, mode] as const)))("accent %s, %s mode", (slug, mode) => {
  const t = { ...base(mode), ...accent(slug, mode) };
  const own = accent(slug, mode);
  const c = (name: string) => hex(t[name]!);

  it("has its own block with every accent token as six-digit hex", () => {
    for (const k of ACCENT_TOKENS) {
      expect(own[k], `${slug} ${mode} misses --${k}`).toBeDefined();
      expect(() => hex(own[k]!)).not.toThrow();
    }
  });

  it("button labels meet 4.5:1 on the accent and its hover", () => {
    expect(contrast(c("accent-ink"), c("accent"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(c("accent-ink"), c("accent-hover"))).toBeGreaterThanOrEqual(4.5);
  });

  it("text on the strong accent card meets 4.5:1, also on its darkened pills (15 % black)", () => {
    expect(contrast(c("accent-strong-ink"), c("accent-strong"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(c("accent-strong-ink"), mix([0, 0, 0], c("accent-strong"), 0.15))).toBeGreaterThanOrEqual(4.5);
  });

  it("accent text meets 4.5:1 on every surface, on its soft tint and on the hero card", () => {
    for (const bg of ["bg", "surface", "surface-2", "accent-soft"]) expect(contrast(c("accent-text"), c(bg)), `accent-text on ${bg}`).toBeGreaterThanOrEqual(4.5);
    for (const fg of ["ink", "ink-2", "ink-3"]) expect(contrast(c(fg), c("accent-soft")), `${fg} on accent-soft`).toBeGreaterThanOrEqual(4.5);
  });

  it("accent marks reach 3:1 on cards and on the hero card (focus ring, bars, active navigation)", () => {
    for (const bg of ["surface", "bg"]) expect(contrast(c("accent"), c(bg)), `accent on ${bg}`).toBeGreaterThanOrEqual(3);
    // The hero card is a dark island (data-mode="dark") in both modes, so it always uses the dark accent.
    if (mode === "dark") expect(contrast(c("accent"), c("hero")), "accent on hero").toBeGreaterThanOrEqual(3);
  });

  it("stays a cool colour: hue between green and violet, never yellow, orange, brown or red", () => {
    const [r, g, b] = c("accent").map((v) => v / 255) as [number, number, number];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const d = max - min;
    let h = 0;
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    const hue = (h * 60 + 360) % 360;
    expect(hue, `${slug} ${mode} accent hue`).toBeGreaterThanOrEqual(150);
    expect(hue, `${slug} ${mode} accent hue`).toBeLessThanOrEqual(285);
  });
});

describe("style rules", () => {
  it("uses no gradients and no glow", () => {
    expect(css).not.toMatch(/gradient\(/);
    // Blur is only allowed behind the frosted login panel (backdrop-filter), never on text or shapes.
    expect(css).not.toMatch(/text-shadow|drop-shadow|(?<!backdrop-)filter:\s*blur\(/);
  });

  it("self-hosts Allo and no other font family", () => {
    const families = [...css.matchAll(/font-family:\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(families)).toEqual(new Set(["Allo"]));
    expect(css).toMatch(/url\("\.\/fonts\/allo\/AlloVariableFriendly\.woff2"\)/);
    expect(css).not.toMatch(/@import\s+url\(\s*["']?https?:/);
  });
});

describe("light and dark mode", () => {
  it("only the exact value dark switches to dark; anything else, also nothing stored, is light", () => {
    expect(resolveMode("dark")).toBe("dark");
    for (const value of [null, undefined, "", "light", "DARK", " dark", "dark;", '"><script>', {}, 1]) expect(resolveMode(value)).toBe("light");
  });
});
