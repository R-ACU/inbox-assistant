/**
 * Deterministic checks that run on every mail before and independent of the
 * model. They can only make the outcome stricter: a rule hit with severity
 * "error" forces the mail into quarantine, whatever the model said.
 */
import { pick, type Locale } from "../shared/locale";
import type { Address, Finding, InboundMail, MailAuth } from "../shared/types";

interface Pattern {
  code: string;
  severity: Finding["severity"];
  /** German and English wording, shown to the owner in the language of the deployment. */
  message: [de: string, en: string];
  re: RegExp;
}

// JavaScript's \b and \w only know ASCII letters, so "\büberweise" never
// matches. Patterns below are written with \b and \w for readability and
// compiled with Unicode-aware replacements.
const WORD = String.raw`[\p{L}\p{N}_]`;
const BOUNDARY = String.raw`(?:(?<!${WORD})(?=${WORD})|(?<=${WORD})(?!${WORD}))`;

function unicodeWords(source: string): RegExp {
  return new RegExp(source.replaceAll(String.raw`\b`, BOUNDARY).replaceAll(String.raw`\w`, WORD), "iu");
}

// Instruction patterns allow up to 80 characters between verb and object, and the
// scan text has its line breaks turned into spaces, so a blank line or a long
// filler phrase does not split the sentence.
const GAP = String.raw`[^.]{0,80}`;

const PATTERNS: Pattern[] = [
  {
    code: "instruction_override",
    severity: "error",
    message: ["Die Mail versucht, dem Assistenten Anweisungen zu geben (Regeln ignorieren).", "The mail tries to give the assistant instructions (ignore the rules)."],
    re: unicodeWords(String.raw`\b(ignorier\w*|vergiss|vergessen|missachte\w*)\b${GAP}\b(regeln|anweisungen|vorgaben|instruktionen|prompt)\b`),
  },
  {
    // Paraphrases: "beachte die bisherigen Vorgaben nicht mehr", "die Regeln gelten nicht mehr".
    code: "instruction_override",
    severity: "error",
    message: ["Die Mail versucht, die Regeln des Assistenten außer Kraft zu setzen.", "The mail tries to switch off the assistant's rules."],
    re: unicodeWords(
      String.raw`\b(beachte\w*|befolge\w*|berücksichtige\w*|halte\w*)\b${GAP}\b(regeln|anweisungen|vorgaben|instruktionen)\b[^.]{0,40}\bnicht\b|\b(regeln|anweisungen|vorgaben|instruktionen)\b[^.]{0,40}\b(gelten nicht|außer kraft|aufgehoben|sind ungültig)`,
    ),
  },
  {
    // More paraphrases: "Vergessen Sie alles, was man Ihnen vorher gesagt hat",
    // "Neue Anweisung: ...", "Ab sofort gelten nur noch meine Anweisungen".
    code: "instruction_override",
    severity: "error",
    message: ["Die Mail versucht, dem Assistenten neue Anweisungen zu geben.", "The mail tries to give the assistant new instructions."],
    re: unicodeWords(
      String.raw`\b(vergiss|vergessen)\b[^.]{0,20}\balles\b[^.]{0,60}\b(vorher|bisher|zuvor|davor|gesagt)\w*` +
        String.raw`|\bneue (anweisung|instruktion|regel|vorgabe)\w*\s*:` +
        String.raw`|\bnur noch (meine|unsere|diese)\w*\b[^.]{0,20}\b(anweisung|instruktion|regel|vorgabe)\w*`,
    ),
  },
  {
    code: "instruction_override",
    severity: "error",
    message: ["Die Mail versucht, die Anweisungen des Assistenten zu überschreiben.", "The mail tries to override the assistant's instructions."],
    re: unicodeWords(
      String.raw`\b(ignore|disregard|forget|pay no attention to|do not follow|don't follow|stop following)\b${GAP}\b(rules|instructions|guidelines|prompt)\b` +
        String.raw`|\bforget everything\b[^.]{0,60}\b(before|previously|earlier|told)\b|\bnew instructions?\s*:`,
    ),
  },
  {
    code: "addresses_assistant",
    severity: "error",
    message: ["Die Mail spricht ein KI-System direkt an.", "The mail speaks to an AI system directly."],
    re: unicodeWords(String.raw`\b(system ?prompt|du bist (jetzt|ab sofort)|you are now|als (ki|sprachmodell)|as an ai|ki-assistent\w*|assistant:)`),
  },
  {
    // Only "überweisen" counts: "zahlbar sofort" is normal invoice wording.
    code: "payment_pressure",
    severity: "warning",
    message: ["Zahlungsdruck im Text (sofort oder dringend überweisen).", "Payment pressure in the text (transfer at once or urgently)."],
    re: unicodeWords(
      String.raw`\b(überweis|ueberweis)\w*\b[^.]{0,30}\b(sofort|umgehend|unverzüglich|heute noch|dringend)\b|\b(sofort|umgehend|dringend)\b[^.]{0,20}\b(überweis|ueberweis)\w*`,
    ),
  },
  {
    // English: only "transfer" or "wire" counts, "payment due immediately" is normal invoice wording.
    code: "payment_pressure",
    severity: "warning",
    message: ["Zahlungsdruck im Text (sofort oder dringend überweisen).", "Payment pressure in the text (transfer at once or urgently)."],
    re: unicodeWords(
      String.raw`\b(transfer|wire)\w*\b[^.]{0,30}\b(immediately|urgently|right away|today|at once|asap)\b|\b(immediately|urgently|today)\b[^.]{0,20}\b(transfer|wire)\w*`,
    ),
  },
  {
    code: "bank_change",
    severity: "warning",
    message: ["Die Mail kündigt eine neue oder geänderte Bankverbindung an.", "The mail announces new or changed bank details."],
    re: unicodeWords(
      String.raw`\b(neue|geänderte|geaenderte|aktualisierte|new|updated)\b[^.]{0,20}\b(bankverbindung|iban|kontoverbindung|bank details|account details)\b`,
    ),
  },
];

// Cyrillic and Greek letters that look like Latin ones ("Ignоriere" with a Cyrillic o).
// The scan text maps them to Latin so a homoglyph does not hide a keyword.
const CONFUSABLES: Record<string, string> = {
  а: "a", в: "b", е: "e", ё: "e", к: "k", м: "m", н: "h", о: "o", р: "p", с: "c", т: "t", у: "y", х: "x",
  і: "i", ї: "i", ј: "j", ѕ: "s", ԁ: "d", һ: "h", ԛ: "q", ԝ: "w",
  А: "A", В: "B", Е: "E", К: "K", М: "M", Н: "H", О: "O", Р: "P", С: "C", Т: "T", У: "Y", Х: "X", І: "I", Ј: "J", Ѕ: "S",
  α: "a", β: "b", ε: "e", ι: "i", κ: "k", ν: "v", ο: "o", ρ: "p", τ: "t", υ: "u", χ: "x",
  Α: "A", Β: "B", Ε: "E", Ζ: "Z", Η: "H", Ι: "I", Κ: "K", Μ: "M", Ν: "N", Ο: "O", Ρ: "P", Τ: "T", Υ: "Y", Χ: "X",
};
const CONFUSABLE_RE = new RegExp(`[${Object.keys(CONFUSABLES).join("")}]`, "gu");
const MIXED_SCRIPT_WORD = /(?=[\p{L}]*\p{Script=Latin})(?=[\p{L}]*[\p{Script=Cyrillic}\p{Script=Greek}])[\p{L}]{2,}/u;

// Cheap folds against the usual keyword-hiding tricks. They only change the scan
// copy, so a strange result for a harmless word costs nothing unless it happens to
// spell out one of the patterns above.
// "Ignor-\niere": a hyphen at a line break followed by a lower-case letter is a split word.
const SPLIT_WORD = /(\p{L})-[ \t]*\r?\n\s*(?=\p{Ll})/gu;
// "I g n o r i e r e", "I.g.n.o.r.i.e.r.e": three or more single letters with one separator each.
const SPACED_LETTERS = /(?<![\p{L}\p{N}])\p{L}(?:[ ._-]\p{L}(?![\p{L}\p{N}])){2,}/gu;
// "Ign0riere": digits used as letters, but only inside a token that also has letters,
// so amounts, dates and invoice numbers stay untouched. "1" is read both as i and as l.
const MIXED_TOKEN = /(?=[\p{L}\p{N}]*\p{L})(?=[\p{L}\p{N}]*\p{N})[\p{L}\p{N}]+/gu;
const LEET_BASE: Record<string, string> = { "0": "o", "3": "e", "4": "a", "5": "s", "7": "t" };

function unleet(token: string, one: "i" | "l"): string {
  return token.replace(/[013457]/g, (d) => (d === "1" ? one : (LEET_BASE[d] ?? d)));
}

/**
 * The texts the patterns run on: NFKC folds full-width and other compatibility
 * forms ("Ｉｇｎｏｒｉｅｒｅ") to plain letters, homoglyphs become Latin, split words
 * and spaced letters are joined, digits inside words become letters, line breaks
 * become spaces. Two variants, because "1" stands for "i" or "l". Only used for
 * scanning; what the owner sees is unchanged.
 */
export function scanTexts(input: string): string[] {
  const base = input
    .normalize("NFKC")
    .replace(CONFUSABLE_RE, (ch) => CONFUSABLES[ch] ?? ch)
    .replace(SPLIT_WORD, "$1")
    .replace(/\s+/g, " ")
    .replace(SPACED_LETTERS, (m) => m.replace(/[ ._-]/g, ""));
  return (["i", "l"] as const).map((one) => base.replace(MIXED_TOKEN, (t) => unleet(t, one)));
}

function domainOf(address: string): string {
  return address.split("@")[1]?.toLowerCase() ?? "";
}

const FAILED = new Set(["fail", "softfail", "permerror"]);

/**
 * The From header alone proves nothing. If the receiving server recorded SPF, DKIM and
 * DMARC results, a failed DMARC check is an error (forged sender domain), a failed SPF
 * or DKIM check without a DMARC pass is a warning. Without the header nothing is said.
 */
function authFindings(auth: MailAuth | undefined, locale: Locale): Finding[] {
  if (!auth) return [];
  if (auth.dmarc === "fail") {
    return [{ code: "sender_auth_failed", severity: "error", message: pick(locale, "DMARC-Prüfung fehlgeschlagen: Die Absenderdomain ist vermutlich gefälscht.", "DMARC check failed: the sender domain is probably forged.") }];
  }
  const failed = (["spf", "dkim"] as const).filter((m) => auth[m] && FAILED.has(auth[m]!));
  if (failed.length > 0 && auth.dmarc !== "pass") {
    return [
      {
        code: "sender_auth_weak",
        severity: "warning",
        message: pick(
          locale,
          `${failed.map((m) => m.toUpperCase()).join(" und ")} fehlgeschlagen: Der Absender ist nicht sicher bestätigt.`,
          `${failed.map((m) => m.toUpperCase()).join(" and ")} failed: the sender is not reliably confirmed.`,
        ),
      },
    ];
  }
  return [];
}

function senderFindings(from: Address, replyTo: Address | null, locale: Locale): Finding[] {
  const out: Finding[] = [];
  if (replyTo && domainOf(replyTo.address) !== domainOf(from.address)) {
    out.push({
      code: "reply_to_mismatch",
      severity: "warning",
      message: pick(
        locale,
        `Antwortadresse (${replyTo.address}) gehört zu einer anderen Domain als der Absender.`,
        `Reply-to address (${replyTo.address}) belongs to another domain than the sender.`,
      ),
    });
  }
  const nameMail = from.name.match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/);
  if (nameMail && nameMail[0].toLowerCase() !== from.address.toLowerCase()) {
    out.push({
      code: "display_name_spoof",
      severity: "error",
      message: pick(locale, "Der Anzeigename enthält eine andere Mailadresse als der echte Absender.", "The display name contains another mail address than the real sender."),
    });
  }
  return out;
}

/**
 * Scans subject and body. Each code is reported once. Attachment contents
 * (PDF text) are not scanned here; see SECURITY.md, known limits.
 */
export function scanMail(
  mail: Pick<InboundMail, "subject" | "text" | "from" | "replyTo" | "hiddenCharacters" | "auth">,
  locale: Locale = "de",
): Finding[] {
  const raw = `${mail.subject}. ${mail.text}`;
  const haystacks = scanTexts(raw);
  const seen = new Set<string>();
  const findings: Finding[] = [];
  if (mail.hiddenCharacters) {
    findings.push({
      code: "hidden_characters",
      severity: "error",
      message: pick(
        locale,
        `Die Mail enthält ${mail.hiddenCharacters} unsichtbare Steuer- oder Tag-Zeichen. Damit lässt sich Text vor Menschen verstecken.`,
        `The mail contains ${mail.hiddenCharacters} invisible control or tag characters. They can hide text from people.`,
      ),
    });
  }
  if (MIXED_SCRIPT_WORD.test(raw.normalize("NFKC"))) {
    findings.push({
      code: "mixed_script",
      severity: "warning",
      message: pick(
        locale,
        "Wörter mischen lateinische mit kyrillischen oder griechischen Buchstaben (getarnte Schreibweise).",
        "Words mix Latin with Cyrillic or Greek letters (disguised spelling).",
      ),
    });
  }
  for (const p of PATTERNS) {
    if (seen.has(p.code) || !haystacks.some((h) => p.re.test(h))) continue;
    seen.add(p.code);
    findings.push({ code: p.code, severity: p.severity, message: pick(locale, ...p.message) });
  }
  return [...findings, ...senderFindings(mail.from, mail.replyTo, locale), ...authFindings(mail.auth, locale)];
}

export function hasBlockingFinding(findings: Finding[]): boolean {
  return findings.some((f) => f.severity === "error");
}
