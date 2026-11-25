/**
 * Checks on a reply draft written by the model. The draft is never sent on its
 * own; these findings are shown next to it in the approval queue so the owner
 * sees at a glance where the model went beyond the FAQ.
 */
import type { ReplyDraft } from "../shared/schemas";
import { pick, type Locale } from "../shared/locale";
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

// English drafts write the euro sign before the amount ("€9", "€5,000") and use English units.
const NUMBER_FACT_EN =
  /€\s?\d+(?:[.,:]\d+)*|\d+(?:[.,:]\d+)*(?:\s?(?:%|percent\b|euros?\b|eur\b|weeks?\b|working days?\b|days?\b|hours?\b|am\b|pm\b|km\b|m²|sq\.? ?m\b))/gi;

function normalizeFactEn(raw: string): string {
  const n = raw.toLowerCase().replace(/\s+/g, "");
  const euro = /€|euro|eur/.test(n);
  return (
    n
      .replace(/€|euros?|eur/g, "")
      // English thousands separator: "5,000" and "5000" are the same amount.
      .replace(/,(?=\d{3}\b)/g, "")
      .replace("percent", "%")
      .replace(/workingdays?/, "wd")
      .replace(/weeks?/, "week")
      .replace(/days?/, "day")
      .replace(/hours?/, "hour")
      .replace(/sq\.?m/, "m²") + (euro ? "€" : "")
  );
}

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

interface FactRules {
  re: RegExp;
  normalize: (raw: string) => string;
}

const FACTS: Record<Locale, FactRules> = {
  de: { re: NUMBER_FACT, normalize: normalizeFact },
  en: { re: NUMBER_FACT_EN, normalize: normalizeFactEn },
};

function factsIn(text: string, rules: FactRules): Set<string> {
  return new Set([...text.matchAll(rules.re)].map((m) => rules.normalize(m[0])));
}

/** Facts as written in the text (for messages), one per normalized value. */
function factsAsWritten(text: string, rules: FactRules): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of text.matchAll(rules.re)) {
    const key = rules.normalize(m[0]);
    if (!out.has(key)) out.set(key, m[0].trim());
  }
  return out;
}

export interface DraftCheckContext {
  /** Language of the draft and of the findings (default German). */
  locale?: Locale;
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
  const locale = ctx.locale ?? "de";
  const say = (de: string, en: string) => pick(locale, de, en);
  const rules = FACTS[locale];

  const unknown = draft.used_faq_ids.filter((id) => !faqById.has(id));
  if (unknown.length > 0) {
    findings.push({
      code: "unknown_faq",
      severity: "error",
      message: say(`Entwurf beruft sich auf unbekannte FAQ-Einträge: ${unknown.join(", ")}.`, `The draft cites unknown FAQ entries: ${unknown.join(", ")}.`),
    });
  }
  if (draft.used_faq_ids.length === 0 && ctx.requireFaq !== false) {
    findings.push({
      code: "no_faq",
      severity: "warning",
      message: say("Entwurf stützt sich auf keinen FAQ-Eintrag. Inhalt besonders genau prüfen.", "The draft rests on no FAQ entry. Check the content with extra care."),
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
  const allowed = factsIn(sourceText, rules);
  const invented = [...factsAsWritten(body, rules)].filter(([key]) => !allowed.has(key)).map(([, written]) => written);

  // Second net: any other number (dates like "03.12.", times like "7:30", house numbers in a
  // promise) must appear somewhere in the sources.
  const sourceNumbers = numbersIn(sourceText);
  const rest = body.replace(rules.re, " ").replace(URL_RE, " ");
  const strayNumbers = [...new Set([...rest.matchAll(/\d+(?:[.:]\d+)*\.?/g)].map((m) => m[0]))].filter(
    (written) => [...written.matchAll(DIGITS)].some((d) => !sourceNumbers.has(String(Number(d[0])))),
  );
  invented.push(...strayNumbers);
  if (invented.length > 0) {
    findings.push({
      code: "unsupported_fact",
      severity: "error",
      message: say(
        `Angabe ohne Quelle in FAQ oder Anfrage: ${invented.map((f) => `„${f}“`).join(", ")}. Bitte prüfen oder streichen.`,
        `Claim with no source in the FAQ or the enquiry: ${invented.map((f) => `“${f}”`).join(", ")}. Please check or remove it.`,
      ),
    });
  }

  const foreignLinks = [...draft.body.matchAll(URL_RE)]
    .map((m) => m[0])
    .filter((u) => !isAllowedLink(u, ctx.allowedDomains));
  if (foreignLinks.length > 0) {
    findings.push({ code: "foreign_link", severity: "error", message: say("Entwurf enthält fremde Links.", "The draft contains foreign links.") });
  }
  if (IBAN_LIKE.test(draft.body)) {
    findings.push({
      code: "bank_details",
      severity: "error",
      message: say("Entwurf enthält Bankdaten. Die gehören nie in eine automatisch entworfene Antwort.", "The draft contains bank details. They never belong in a drafted reply."),
    });
  }
  if (draft.body.length < 80) {
    findings.push({ code: "too_short", severity: "warning", message: say("Entwurf ist sehr kurz.", "The draft is very short.") });
  }
  for (const q of draft.open_questions) {
    findings.push({ code: "open_question", severity: "info", message: say(`Vor dem Senden klären: ${q}`, `Clear up before sending: ${q}`) });
  }
  return findings;
}
