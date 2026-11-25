/**
 * The app shell (index.html) in the language of the deployment. The built file is German; for the English
 * tenant the server swaps `lang`, title and description before sending it, so the web UI reads its language
 * from <html lang> before the first render (web/src/i18n.ts). Used by the server and by the Vite dev server.
 */
import type { Locale } from "../shared/locale";

const SHELL: Record<Locale, { title: string; description: string }> = {
  de: {
    title: "Hofmann &amp; Kraft | Posteingang-Assistent",
    description: "Posteingang-Assistent des Malerbetriebs Hofmann &amp; Kraft (Demo mit erfundenen Daten)",
  },
  en: {
    title: "Brennan &amp; Doyle | Inbox assistant",
    description: "Inbox assistant of Brennan &amp; Doyle Painting (demo with invented data)",
  },
};

export function localizeIndexHtml(html: string, locale: Locale): string {
  const shell = SHELL[locale];
  return html
    .replace(/<html lang="[a-z]+"/, `<html lang="${locale}"`)
    .replace(/<title>[^<]*<\/title>/, `<title>${shell.title}</title>`)
    .replace(/<meta name="description" content="[^"]*"/, `<meta name="description" content="${shell.description}"`);
}
