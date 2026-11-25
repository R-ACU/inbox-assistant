/**
 * Language of this deployment. One server runs one tenant in one language (APP_LOCALE, see
 * src/server/config.ts); the server writes it into <html lang> before the first byte reaches the browser,
 * so the UI knows it synchronously and never renders in the wrong language first.
 *
 * Texts are written next to each other at the place they are used: `t("Freigabe", "Approval")`. German
 * comes first because the UI was written in German; the English deployment picks the second one.
 */
import type { Locale } from "../../src/shared/locale";

export type { Locale };

const lang = typeof document === "undefined" ? "de" : document.documentElement.lang;

export const LOCALE: Locale = lang === "en" ? "en" : "de";
export const EN = LOCALE === "en";

/** The German or the English text, whichever this deployment speaks. */
export function t<T>(de: T, en: T): T {
  return EN ? en : de;
}

/** BCP 47 tag for Intl formatters: German as in Germany, English as in Ireland (EUR, day before month). */
export const INTL_LOCALE = EN ? "en-IE" : "de-DE";

/** Wall clock of the business: Germany for the German tenant, Ireland for the English one. */
export const TIME_ZONE = EN ? "Europe/Dublin" : "Europe/Berlin";

/** URL paths of the views. The English deployment gets English paths. */
export const ROUTES = EN
  ? { overview: "/", approval: "/approval", review: "/review", inbox: "/inbox", mail: "/mail", invoices: "/invoices", reconcile: "/reconcile", week: "/week" }
  : { overview: "/", approval: "/freigabe", review: "/pruefliste", inbox: "/posteingang", mail: "/mail", invoices: "/rechnungen", reconcile: "/abgleich", week: "/woche" };
