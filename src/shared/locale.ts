/**
 * The language of a deployment. One server runs one tenant in one language (APP_LOCALE): the German
 * painting business with a German UI, or the Irish one with an English UI. Code, identifiers and logs stay
 * English in both; only what the owner reads changes.
 */
export type Locale = "de" | "en";

export const LOCALES = ["de", "en"] as const satisfies readonly Locale[];

/** The German or the English wording. German comes first because the app was written in German. */
export function pick<T>(locale: Locale | undefined, de: T, en: T): T {
  return locale === "en" ? en : de;
}
