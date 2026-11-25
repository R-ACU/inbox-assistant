/**
 * Checks on a reply draft written by the model. The draft is never sent on its
 * own; these findings are shown next to it in the approval queue so the owner
 * sees at a glance where the model went beyond the FAQ.
 */
import type { ReplyDraft } from "../shared/schemas";
import type { Finding } from "../shared/types";

export interface FaqEntry {
  id: string;
  question: string;
  answer: string;
}

// Amounts, percentages, durations and times are the facts a customer will hold us to.
// "2400,-" counts as an amount. Numbers without a unit (dates, "7:30") are covered by
// the second check below: every number in the draft must appear in a source.
const NUMBER_FACT =
  /\d+(?:[.,:]\d+)*(?:\s?(?:€|eur\b|euro\b|%|prozent\b|wochen?\b|werktage?n?\b|tage?n?\b|stunden?\b|std\b|uhr\b|km\b|m²|qm\b)|,-)/gi;
const DIGITS = /\d+/g;
const URL_RE = /\bhttps?:\/\/[^\s)]+|\bwww\.[^\s)]+/gi;
const IBAN_LIKE = /\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){3,7}\b/;

function normalizeFact(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/,-$/, "€")
    .replace(/\s+/g, "")
    .replace(",", ".")
    .replace(/euro|eur/, "€")
    .replace("prozent", "%")
    .replace(/werktage?n?/, "werktag")
    .replace(/wochen?/, "woche")
    .replace(/tage?n?/, "tag")
    .replace(/stunden?|std/, "stunde")
    .replace("qm", "m²");
}

/** Plain numbers ("03", "12", "7") as integers, for the any-number check. */
function numbersIn(text: string): Set<string> {
  return new Set([...text.matchAll(DIGITS)].map((m) => String(Number(m[0]))));
}

/** Is the URL on one of the allowed domains (the host itself or a subdomain, not just a substring)? */
export function isAllowedLink(raw: string, allowedDomains: string[]): boolean {
  const cleaned = raw.replace(/[.,;:!?]+$/, "");
  let host: string;
  try {
    host = new URL(/^https?:\/\//i.test(cleaned) ? cleaned : `http://${cleaned}`).hostname.toLowerCase();
  } catch {
    return false;
  }
  return allowedDomains.some((d) => host === d.toLowerCase() || host.endsWith(`.${d.toLowerCase()}`));
}

function factsIn(text: string): Set<string> {
  return new Set([...text.matchAll(NUMBER_FACT)].map((m) => normalizeFact(m[0])));
}

/** Facts as written in the text (for messages), one per normalized value. */
function factsAsWritten(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of text.matchAll(NUMBER_FACT)) {
    const key = normalizeFact(m[0]);
    if (!out.has(key)) out.set(key, m[0].trim());
  }
  return out;
}

export interface DraftCheckContext {
  faq: FaqEntry[];
  mailText: string;
  allowedDomains: string[];
  signature?: string;
  /** Facts from the business's own checks (a requested reply to an invoice); their numbers count as sources. */
  notes?: string[];
  /** Warn when no FAQ entry is used. On for inquiries; a reply to an invoice or a notice needs none. */
  requireFaq?: boolean;
}

export function checkDraft(draft: ReplyDraft, ctx: DraftCheckContext): Finding[] {
  const findings: Finding[] = [];
  const faqById = new Map(ctx.faq.map((f) => [f.id, f]));

  const unknown = draft.used_faq_ids.filter((id) => !faqById.has(id));
  if (unknown.length > 0) {
    findings.push({
      code: "unknown_faq",
      severity: "error",
      message: `Entwurf beruft sich auf unbekannte FAQ-Einträge: ${unknown.join(", ")}.`,
    });
  }
  if (draft.used_faq_ids.length === 0 && ctx.requireFaq !== false) {
    findings.push({
      code: "no_faq",
      severity: "warning",
      message: "Entwurf stützt sich auf keinen FAQ-Eintrag. Inhalt besonders genau prüfen.",
    });
  }

  // Every number fact in the draft must appear in a FAQ entry it used, in the mail or in the notes of our own checks.
  const sourceText = [
    ctx.mailText,
    ...(ctx.notes ?? []),
    ...draft.used_faq_ids.map((id) => faqById.get(id)?.answer ?? ""),
  ].join("\n");
  // The company signature (address, phone) is not a promise and is not checked.
  const body = ctx.signature ? draft.body.replace(ctx.signature, "") : draft.body;
  const allowed = factsIn(sourceText);
  const invented = [...factsAsWritten(body)].filter(([key]) => !allowed.has(key)).map(([, written]) => written);

  // Second net: any other number (dates like "03.12.", times like "7:30", house numbers in a
  // promise) must appear somewhere in the sources.
  const sourceNumbers = numbersIn(sourceText);
  const rest = body.replace(NUMBER_FACT, " ").replace(URL_RE, " ");
  const strayNumbers = [...new Set([...rest.matchAll(/\d+(?:[.:]\d+)*\.?/g)].map((m) => m[0]))].filter(
    (written) => [...written.matchAll(DIGITS)].some((d) => !sourceNumbers.has(String(Number(d[0])))),
  );
  invented.push(...strayNumbers);
  if (invented.length > 0) {
    findings.push({
      code: "unsupported_fact",
      severity: "error",
      message: `Angabe ohne Quelle in FAQ oder Anfrage: ${invented.map((f) => `„${f}“`).join(", ")}. Bitte prüfen oder streichen.`,
    });
  }

  const foreignLinks = [...draft.body.matchAll(URL_RE)]
    .map((m) => m[0])
    .filter((u) => !isAllowedLink(u, ctx.allowedDomains));
  if (foreignLinks.length > 0) {
    findings.push({ code: "foreign_link", severity: "error", message: "Entwurf enthält fremde Links." });
  }
  if (IBAN_LIKE.test(draft.body)) {
    findings.push({
      code: "bank_details",
      severity: "error",
      message: "Entwurf enthält Bankdaten. Die gehören nie in eine automatisch entworfene Antwort.",
    });
  }
  if (draft.body.length < 80) {
    findings.push({ code: "too_short", severity: "warning", message: "Entwurf ist sehr kurz." });
  }
  for (const q of draft.open_questions) {
    findings.push({ code: "open_question", severity: "info", message: `Vor dem Senden klären: ${q}` });
  }
  return findings;
}
