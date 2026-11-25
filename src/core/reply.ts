/**
 * Replies the owner asks for himself ("Antwort entwerfen") on a mail the intake did not draft a reply for:
 * an invoice, a notice, a mail on the review list or an inquiry whose draft he discarded. Pure rules,
 * shared by the server and the web UI.
 *
 * The reply runs through the same approval and sending path as an intake draft, so while it waits the
 * mail's status is "awaiting_approval". Once the reply is sent or discarded the mail goes back to the
 * status it had before (an invoice stays filed, a mail on the review list stays there); only an inquiry
 * whose first draft was discarded counts as answered afterwards.
 */
import { pick, type Locale } from "../shared/locale";
import type { MailStatus, ProcessedMail } from "../shared/types";

/** Where a reply on request may start. Never from quarantine: nothing ever leaves for a suspicious mail. */
export const REPLY_FROM: readonly MailStatus[] = ["filed", "needs_review", "resolved", "discarded"];

/** States in which a requested reply is still on its way (waiting, approved, hand-over failed). */
const IN_FLIGHT: readonly MailStatus[] = ["awaiting_approval", "approved", "delivery_failed"];

type ReplyFields = Pick<ProcessedMail, "category" | "status" | "draft">;

/** Why the owner cannot ask for a reply to this mail, or null if he can. */
export function replyBlocked(record: ReplyFields, locale: Locale = "de"): string | null {
  if (record.category === "suspicious" || record.status === "quarantined") {
    return pick(locale, "Auf verdächtige Mails wird nie geantwortet.", "Suspicious mails never get a reply.");
  }
  if (record.draft?.requested?.sentAt) return pick(locale, "Auf diese Mail wurde schon geantwortet.", "This mail has already been answered.");
  if (!REPLY_FROM.includes(record.status)) {
    return pick(locale, "Für diese Mail gibt es schon einen Entwurf oder eine Antwort.", "This mail already has a draft or a reply.");
  }
  return null;
}

/** The status a mail takes when its reply is sent or discarded. */
export function statusAfterReply(record: ReplyFields, outcome: "sent" | "discarded"): MailStatus {
  const from = record.draft?.requested?.from;
  if (!from || from === "discarded") return outcome;
  return from;
}

/**
 * The mail's own status, as if no requested reply were on its way. Bookkeeping uses it: an invoice stays
 * filed (and counted) while a reply to its supplier waits for approval.
 */
export function settledStatus(record: ReplyFields): MailStatus {
  const from = record.draft?.requested?.from;
  return from && IN_FLIGHT.includes(record.status) ? from : record.status;
}

/** Did the owner get a reply out for this mail (an intake draft or one he asked for)? */
export function replySent(record: ReplyFields): boolean {
  return record.status === "sent" || !!record.draft?.requested?.sentAt;
}

const euro = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
const euroIe = new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" });
const germanDate = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return `${Number(d)}.${Number(m)}.${y}`;
};
/** Irish date order, day first: 19/11/2026. */
const irishDate = (iso: string) => iso.split("-").reverse().join("/");

/**
 * Facts from the business's own checks that a requested reply may use: what was read from an invoice and
 * what the code found when it recomputed it. The model sees them as notes; the draft check accepts their
 * numbers as sources, so "the lines add up to 983,19 €" is not flagged as invented.
 */
export function replyNotes(record: Pick<ProcessedMail, "invoice" | "reviewReasons" | "status">, locale: Locale = "de"): string[] {
  const notes: string[] = [];
  const inv = record.invoice;
  const en = locale === "en";
  if (inv) {
    const ex = inv.extraction;
    if (!ex.readable) {
      notes.push(pick(locale, "Der Beleg ist nicht sicher lesbar.", "The document is not reliably readable."));
    } else {
      const parts = en
        ? [
            `Invoice ${ex.invoice_number ?? "without a number"}`,
            ex.invoice_date ? `dated ${irishDate(ex.invoice_date)}` : "",
            ex.gross_total !== null ? `for ${euroIe.format(ex.gross_total)} gross` : "",
          ]
        : [
            `Rechnung ${ex.invoice_number ?? "ohne Nummer"}`,
            ex.invoice_date ? `vom ${germanDate(ex.invoice_date)}` : "",
            ex.gross_total !== null ? `über ${euro.format(ex.gross_total)} brutto` : "",
          ];
      notes.push(`${parts.filter(Boolean).join(" ")}.`);
      if (inv.ok) notes.push(pick(locale, "Nachgerechnet: Die Summen stimmen.", "Recomputed: the totals add up."));
    }
    for (const f of inv.findings) if (f.severity !== "info") notes.push(f.message);
  }
  for (const f of record.reviewReasons) if (f.severity !== "info" && !notes.includes(f.message)) notes.push(f.message);
  if (record.status === "filed" && inv?.ok) notes.push(pick(locale, "Die Rechnung ist abgelegt.", "The invoice is filed."));
  return notes.slice(0, 6).map((n) => n.slice(0, 300));
}
