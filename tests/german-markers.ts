/**
 * Finds German left in a text that should be English (the English deployment). Used by the Vitest suite
 * for everything the server writes and by the Playwright suite for every visible text of the English UI.
 */

const UMLAUT = /[äöüÄÖÜß„]/;

// Common German words and the app's German vocabulary. Whole words only, case-insensitive. None of them is
// an English word that the English UI or test set uses.
const WORDS = [
  "und", "der", "das", "nicht", "mit", "für", "bitte", "keine", "kein", "eine", "einen", "ist", "sind", "wird", "auf",
  "zum", "zur", "oder", "noch", "alle", "aus", "nach", "von", "vom", "bei", "über", "wurde", "gibt", "diese", "dieser",
  "prüfen", "pruefen", "prüfliste", "rechnung", "rechnungen", "anfrage", "anfragen", "freigabe", "entwurf", "entwerfen",
  "senden", "gesendet", "verwerfen", "verworfen", "abgelegt", "erledigt", "posteingang", "übersicht", "woche", "abgleich",
  "lieferant", "lieferanten", "hinweis", "hinweise", "anhang", "betrag", "summe", "netto", "brutto", "steuer", "uhr",
  "heute", "gestern", "angebot", "bestellformular", "passwort", "anmelden", "abmelden", "zugang", "öffnen", "zurück",
  "suche", "wartet", "quarantäne", "verdächtig", "sonstiges", "einordnung", "beleg", "positionen", "eingang", "kunde",
  "seite", "ansicht", "fehler", "versand", "ausgang", "monat", "tage", "stunden", "wochen", "neu", "laden", "speichern",
  "schließen", "abbrechen", "weiter", "mehr", "weniger", "gesamt", "einzelpreis", "menge", "datum", "absender", "betreff",
  "antwort", "antworten", "regeln", "mails", "ungültig", "falsch", "malerbetrieb",
].filter((w) => w !== "mails"); // "Mails" is an English label too

const WORD_RE = new RegExp(`(?<![\\p{L}\\p{N}])(${WORDS.join("|")})(?![\\p{L}\\p{N}])`, "iu");

/** The German words or umlauts found in a text, empty when it reads as English. */
export function germanIn(text: string): string[] {
  const hits: string[] = [];
  const umlaut = text.match(UMLAUT);
  if (umlaut) hits.push(umlaut[0]);
  const word = text.match(WORD_RE);
  if (word) hits.push(word[0]);
  return hits;
}

/** Lines of a text that contain German, for readable test failures. */
export function germanLines(text: string): string[] {
  return text
    .split(/\n+/)
    .map((l) => l.trim())
    .filter((l) => l && germanIn(l).length > 0)
    .map((l) => `${l}  <- ${germanIn(l).join(", ")}`);
}
