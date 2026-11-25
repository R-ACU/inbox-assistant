/** API client, router and formatting helpers for the web UI. */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Category } from "../../src/shared/schemas";
import type { MailStatus } from "../../src/shared/types";
import { INTL_LOCALE, TIME_ZONE, t } from "./i18n";

// ---------------------------------------------------------------- API

let csrfToken: string | null = null;
const unauthorizedListeners = new Set<() => void>();

export function setCsrfToken(token: string | null) {
  csrfToken = token;
}

export function onUnauthorized(fn: () => void) {
  unauthorizedListeners.add(fn);
  return () => {
    unauthorizedListeners.delete(fn);
  };
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown; form?: FormData } = {}): Promise<T> {
  const method = init.method ?? "GET";
  // Logging out empties the view cache first, whatever the server answers.
  if (path === "/api/auth/logout") clearViewCache();
  const headers: Record<string, string> = {};
  if (method !== "GET" && csrfToken) headers["x-csrf-token"] = csrfToken;
  let body: BodyInit | undefined;
  if (init.form) body = init.form;
  else if (init.body !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(init.body);
  }
  const res = await fetch(path, { method, headers, body, credentials: "same-origin" });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (res.status === 401 && path !== "/api/auth/login") {
    clearViewCache();
    unauthorizedListeners.forEach((fn) => fn());
  }
  if (!res.ok) throw new ApiError(res.status, data.error ?? t(`Fehler ${res.status}`, `Error ${res.status}`));
  // A change can show on every view: fetch everything cached again, in the background.
  if (method !== "GET" && !path.startsWith("/api/auth/")) refreshViewCache();
  return data as T;
}

// ---------------------------------------------------------------- view cache

/**
 * What each GET path last returned, for this session. A view opened before shows it at once and fetches the
 * fresh answer in the background, instead of starting from a loading placeholder every time. After any change
 * every cached path is fetched again, so a view shows the change as soon as it appears. Logging out or a 401
 * empties the cache; answers still on their way from before are dropped (`generation`).
 */
const viewCache = new Map<string, unknown>();
const cacheListeners = new Set<() => void>();
let generation = 0;

function subscribeViewCache(fn: () => void) {
  cacheListeners.add(fn);
  return () => {
    cacheListeners.delete(fn);
  };
}

function writeViewCache(path: string, data: unknown, since: number) {
  if (since !== generation) return;
  // An unchanged answer keeps the cached object, so views neither re-render nor re-run effects that depend on it.
  if (viewCache.has(path) && JSON.stringify(viewCache.get(path)) === JSON.stringify(data)) return;
  viewCache.set(path, data);
  cacheListeners.forEach((fn) => fn());
}

export function clearViewCache() {
  generation += 1;
  viewCache.clear();
  cacheListeners.forEach((fn) => fn());
}

function refreshViewCache() {
  const since = generation;
  for (const path of [...viewCache.keys()]) {
    api(path).then(
      (d) => writeViewCache(path, d, since),
      () => {},
    );
  }
}

/**
 * Loads data for a view. A path loaded before in this session is there at once and refreshes in the
 * background (see the view cache above). `reload` re-fetches without clearing what is shown, and a new path
 * keeps the previous data on screen until its own answer is there.
 */
export function useApi<T>(path: string | null) {
  const cached = useSyncExternalStore(subscribeViewCache, () => (path === null ? undefined : viewCache.get(path))) as T | undefined;
  const shown = useRef<T | null>(null);
  if (cached !== undefined) shown.current = cached;
  const [error, setError] = useState<string | null>(null);
  /** HTTP status of the last error; 0 for network errors. */
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!path) return;
    let alive = true;
    const since = generation;
    setLoading(true);
    api<T>(path)
      .then((d) => {
        writeViewCache(path, d, since);
        if (alive) {
          setError(null);
          setErrorStatus(null);
        }
      })
      .catch((e: Error) => alive && (setError(e.message), setErrorStatus(e instanceof ApiError ? e.status : 0)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [path, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data: cached ?? shown.current, error, errorStatus, loading, reload };
}

// ---------------------------------------------------------------- router

const routeListeners = new Set<() => void>();
window.addEventListener("popstate", () => routeListeners.forEach((fn) => fn()));

export function navigate(to: string, { replace = false }: { replace?: boolean } = {}) {
  if (to === location.pathname + location.search) return;
  if (replace) history.replaceState(null, "", to);
  else {
    history.pushState(null, "", to);
    window.scrollTo({ top: 0 });
  }
  routeListeners.forEach((fn) => fn());
}

export function usePath(): string {
  return useSyncExternalStore(
    (fn) => {
      routeListeners.add(fn);
      return () => {
        routeListeners.delete(fn);
      };
    },
    () => location.pathname,
  );
}

// ---------------------------------------------------------------- formatting

const eur = new Intl.NumberFormat(INTL_LOCALE, { style: "currency", currency: "EUR" });
export const formatCents = (cents: number) => eur.format(cents / 100);
export const formatEuro = (value: number | null | undefined) => (value === null || value === undefined ? t("nicht erkannt", "not read") : eur.format(value));

const dateTime = new Intl.DateTimeFormat(INTL_LOCALE, { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: TIME_ZONE });
const dateOnly = new Intl.DateTimeFormat(INTL_LOCALE, { day: "2-digit", month: "2-digit", year: "numeric", timeZone: TIME_ZONE });
const dayShort = new Intl.DateTimeFormat(INTL_LOCALE, { weekday: "short", day: "2-digit", month: "2-digit", timeZone: "UTC" });
const dayLong = new Intl.DateTimeFormat(INTL_LOCALE, { day: "numeric", month: "long", timeZone: "UTC" });

export const formatDateTime = (iso: string) => dateTime.format(new Date(iso));
const timeOnly = new Intl.DateTimeFormat(INTL_LOCALE, { hour: "2-digit", minute: "2-digit", timeZone: TIME_ZONE });
const dayMonth = new Intl.DateTimeFormat(INTL_LOCALE, { weekday: "short", day: "2-digit", month: "2-digit", timeZone: TIME_ZONE });
const berlinDay = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });
/** Compact time for list rows: the time for today, otherwise weekday and date. */
export const formatListTime = (iso: string) => {
  const d = new Date(iso);
  return berlinDay.format(d) === berlinDay.format(new Date()) ? timeOnly.format(d) : dayMonth.format(d);
};
export const formatDate = (iso: string) => dateOnly.format(new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso));
export const formatDay = (isoDate: string) => dayShort.format(new Date(`${isoDate}T12:00:00Z`));
export const formatDayLong = (isoDate: string) => dayLong.format(new Date(`${isoDate}T12:00:00Z`));

// ---------------------------------------------------------------- vocabulary

export const CATEGORY_LABEL: Record<Category, string> = t(
  { invoice: "Rechnung", inquiry: "Anfrage", other: "Sonstiges", suspicious: "Verdächtig" },
  { invoice: "Invoice", inquiry: "Enquiry", other: "Other", suspicious: "Suspicious" },
);

export const STATUS_LABEL: Record<MailStatus, string> = t<Record<MailStatus, string>>(
  {
    awaiting_approval: "Wartet auf Freigabe",
    needs_review: "Prüfen",
    quarantined: "Quarantäne",
    filed: "Abgelegt",
    approved: "Freigegeben, Versand läuft",
    delivery_failed: "Versand fehlgeschlagen",
    sent: "Gesendet",
    discarded: "Verworfen",
    resolved: "Erledigt",
  },
  {
    awaiting_approval: "Awaiting approval",
    needs_review: "Review",
    quarantined: "Quarantine",
    filed: "Filed",
    approved: "Approved, sending",
    delivery_failed: "Sending failed",
    sent: "Sent",
    discarded: "Discarded",
    resolved: "Done",
  },
);

export const STATUS_TONE: Record<MailStatus, "neutral" | "warn" | "bad" | "good" | "quiet"> = {
  awaiting_approval: "warn",
  needs_review: "warn",
  quarantined: "bad",
  filed: "quiet",
  approved: "neutral",
  delivery_failed: "bad",
  sent: "good",
  discarded: "quiet",
  resolved: "quiet",
};


/** The query string of the current URL; changes with navigate() and back/forward. */
export function useSearch(): string {
  return useSyncExternalStore(
    (fn) => {
      routeListeners.add(fn);
      return () => {
        routeListeners.delete(fn);
      };
    },
    () => location.search,
  );
}
