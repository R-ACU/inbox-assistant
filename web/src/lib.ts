/** API client, router and formatting helpers for the web UI. */
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { Category } from "../../src/shared/schemas";
import type { MailStatus } from "../../src/shared/types";

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
  if (res.status === 401 && path !== "/api/auth/login") unauthorizedListeners.forEach((fn) => fn());
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Fehler ${res.status}`);
  return data as T;
}

/** Loads data for a view. `reload` re-fetches without clearing what is shown. */
export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** HTTP status of the last error; 0 for network errors. */
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!path) return;
    let alive = true;
    setLoading(true);
    api<T>(path)
      .then((d) => alive && (setData(d), setError(null), setErrorStatus(null)))
      .catch((e: Error) => alive && (setError(e.message), setErrorStatus(e instanceof ApiError ? e.status : 0)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [path, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, errorStatus, loading, reload };
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

const eur = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
export const formatCents = (cents: number) => eur.format(cents / 100);
export const formatEuro = (value: number | null | undefined) => (value === null || value === undefined ? "nicht erkannt" : eur.format(value));

const dateTime = new Intl.DateTimeFormat("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" });
const dateOnly = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Berlin" });
const dayShort = new Intl.DateTimeFormat("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", timeZone: "UTC" });
const dayLong = new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "long", timeZone: "UTC" });

export const formatDateTime = (iso: string) => dateTime.format(new Date(iso));
const timeOnly = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" });
const dayMonth = new Intl.DateTimeFormat("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", timeZone: "Europe/Berlin" });
const berlinDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit" });
/** Compact time for list rows: the time for today, otherwise weekday and date. */
export const formatListTime = (iso: string) => {
  const d = new Date(iso);
  return berlinDay.format(d) === berlinDay.format(new Date()) ? timeOnly.format(d) : dayMonth.format(d);
};
export const formatDate = (iso: string) => dateOnly.format(new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso));
export const formatDay = (isoDate: string) => dayShort.format(new Date(`${isoDate}T12:00:00Z`));
export const formatDayLong = (isoDate: string) => dayLong.format(new Date(`${isoDate}T12:00:00Z`));

// ---------------------------------------------------------------- vocabulary

export const CATEGORY_LABEL: Record<Category, string> = {
  invoice: "Rechnung",
  inquiry: "Anfrage",
  other: "Sonstiges",
  suspicious: "Verdächtig",
};

export const STATUS_LABEL: Record<MailStatus, string> = {
  awaiting_approval: "Wartet auf Freigabe",
  needs_review: "Prüfen",
  quarantined: "Quarantäne",
  filed: "Abgelegt",
  approved: "Freigegeben, Versand läuft",
  delivery_failed: "Versand fehlgeschlagen",
  sent: "Gesendet",
  discarded: "Verworfen",
  resolved: "Erledigt",
};

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
