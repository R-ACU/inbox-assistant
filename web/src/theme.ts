/**
 * Accent per company and light or dark mode.
 * A link like `/?firma=wagemann` (or `/?company=wagemann`) picks the accent colour of the company the demo is shown to;
 * anything that is not on the fixed list falls back to the neutral theme. The value from the URL is
 * only ever used as a lookup key: what reaches the DOM is the key from THEMES and its fixed label,
 * never the raw input. The choice is kept in sessionStorage, so it survives the login and reloads.
 */

export const THEMES = {
  neutral: { company: null },
  netzhandwerker: { company: "Die Netzhandwerker" },
  provipanda: { company: "ProviPanda" },
  wagemann: { company: "Wagemann + Partner" },
  elation: { company: "Elation Health" },
} as const satisfies Record<string, { company: string | null }>;

export type ThemeSlug = keyof typeof THEMES;
export const THEME_SLUGS = Object.keys(THEMES) as ThemeSlug[];
export const DEFAULT_THEME: ThemeSlug = "neutral";
export const THEME_PARAM = "firma";
/** English name of the same parameter (`/?company=wagemann`); checked first, both work in both languages. */
export const THEME_PARAM_EN = "company";
export const THEME_STORAGE_KEY = "inbox-assistant.theme";

/** Maps any input to a known theme. Comparison is exact after trim and lower case; no prototype lookups. */
export function resolveTheme(raw: unknown): ThemeSlug {
  if (typeof raw !== "string" || raw.length > 40) return DEFAULT_THEME;
  const key = raw.trim().toLowerCase();
  return THEME_SLUGS.find((slug) => slug === key) ?? DEFAULT_THEME;
}

/** The URL parameter wins when present (also when it is invalid: then neutral); otherwise the stored choice. */
export function pickTheme(search: string, stored: string | null): ThemeSlug {
  const params = new URLSearchParams(search);
  if (params.has(THEME_PARAM_EN)) return resolveTheme(params.get(THEME_PARAM_EN));
  if (params.has(THEME_PARAM)) return resolveTheme(params.get(THEME_PARAM));
  return resolveTheme(stored);
}

export function companyOf(slug: ThemeSlug): string | null {
  return THEMES[slug].company;
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Reads URL and storage, stores the result and sets `data-theme` on the root element. */
export function applyTheme(root: { dataset: DOMStringMap }, search: string, storage: StorageLike | null): ThemeSlug {
  let stored: string | null = null;
  try {
    stored = storage?.getItem(THEME_STORAGE_KEY) ?? null;
  } catch {
    // Storage can be blocked (private mode, strict settings); the URL still works for this page view.
  }
  const slug = pickTheme(search, stored);
  try {
    storage?.setItem(THEME_STORAGE_KEY, slug);
  } catch {
    // ignore, see above
  }
  root.dataset.theme = slug;
  return slug;
}

let current: ThemeSlug = DEFAULT_THEME;

export function initTheme(): ThemeSlug {
  let storage: StorageLike | null = null;
  try {
    storage = window.sessionStorage;
  } catch {
    storage = null;
  }
  current = applyTheme(document.documentElement, window.location.search, storage);
  return current;
}

export function currentTheme(): ThemeSlug {
  return current;
}

// ---------------------------------------------------------------- light and dark

export type ColorMode = "light" | "dark";
export const MODE_STORAGE_KEY = "inbox-assistant.mode";

/** Only "dark" switches to dark; anything else, including nothing stored, is the light default. */
export function resolveMode(raw: unknown): ColorMode {
  return raw === "dark" ? "dark" : "light";
}

function modeStorage(): StorageLike | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

let currentMode: ColorMode = "light";

export function initMode(): ColorMode {
  let stored: string | null = null;
  try {
    stored = modeStorage()?.getItem(MODE_STORAGE_KEY) ?? null;
  } catch {
    stored = null;
  }
  currentMode = resolveMode(stored);
  document.documentElement.dataset.mode = currentMode;
  return currentMode;
}

const modeListeners = new Set<() => void>();

export function subscribeMode(fn: () => void) {
  modeListeners.add(fn);
  return () => {
    modeListeners.delete(fn);
  };
}

export function getMode(): ColorMode {
  return currentMode;
}

/** Switches the mode, remembers it on this device and lets colours blend for a moment. */
export function setMode(mode: ColorMode) {
  if (mode === currentMode) return;
  const root = document.documentElement;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!reduced) root.classList.add("mode-switching");
  currentMode = mode;
  root.dataset.mode = mode;
  try {
    modeStorage()?.setItem(MODE_STORAGE_KEY, mode);
  } catch {
    // Storage can be blocked; the mode then holds for this page view only.
  }
  modeListeners.forEach((fn) => fn());
  if (!reduced) window.setTimeout(() => root.classList.remove("mode-switching"), 280);
}
