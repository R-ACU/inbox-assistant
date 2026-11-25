/** Weekly summary, computed from stored records. Pure function, no I/O. */
import { pick, type Locale } from "../shared/locale";
import { CATEGORIES, type Category } from "../shared/schemas";
import type { ProcessedMail, WeeklySummary } from "../shared/types";
import { findSupplier } from "./invoice-check";
import { toCents } from "./money";
import { replySent, settledStatus } from "./reply";
import type { KnownSupplier } from "./invoice-check";

const DAY = 86_400_000;
/** The German tenant's wall clock; the English tenant passes its own (TenantProfile.timeZone). */
export const DEFAULT_TIME_ZONE = "Europe/Berlin";
const dayFormats = new Map<string, Intl.DateTimeFormat>();

/** Calendar day (YYYY-MM-DD) of a timestamp in the business's time zone. */
export function localDate(iso: string, timeZone = DEFAULT_TIME_ZONE): string {
  let format = dayFormats.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
    dayFormats.set(timeZone, format);
  }
  return format.format(new Date(iso));
}

function utcDate(iso: string): Date {
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`);
}

/** Monday of the ISO week that contains `dateIso` (YYYY-MM-DD). */
export function weekStartOf(dateIso: string): string {
  const d = utcDate(dateIso);
  const offset = (d.getUTCDay() + 6) % 7;
  return new Date(d.getTime() - offset * DAY).toISOString().slice(0, 10);
}

export function isoWeekLabel(mondayIso: string): string {
  const monday = utcDate(mondayIso);
  const thursday = new Date(monday.getTime() + 3 * DAY);
  const yearStart = Date.UTC(thursday.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((thursday.getTime() - yearStart) / DAY + 1) / 7);
  return `${thursday.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function buildWeeklySummary(
  records: ProcessedMail[],
  weekStart: string,
  suppliers: KnownSupplier[],
  opts: { timeZone?: string; locale?: Locale } = {},
): WeeklySummary {
  const tz = opts.timeZone ?? DEFAULT_TIME_ZONE;
  const start = utcDate(weekStart).getTime();
  const end = start + 7 * DAY;
  const lastDay = new Date(end - DAY).toISOString().slice(0, 10);
  const inWeek = records.filter((r) => {
    const day = localDate(r.mail.date, tz);
    return day >= weekStart && day <= lastDay;
  });

  const byCategory = Object.fromEntries(CATEGORIES.map((c) => [c, 0])) as Record<Category, number>;
  for (const r of inWeek) byCategory[r.category] += 1;

  // settledStatus: an invoice stays filed while a reply to its supplier waits for approval.
  const filedInvoices = inWeek.filter((r) => r.category === "invoice" && r.invoice?.ok && settledStatus(r) === "filed");
  const supplierTotals = new Map<string, { grossCents: number; count: number }>();
  let invoicesGross = 0;
  for (const r of filedInvoices) {
    const gross = toCents(r.invoice!.extraction.gross_total) ?? 0;
    invoicesGross += gross;
    const ex = r.invoice!.extraction;
    const name = findSupplier(ex.supplier_name, suppliers)?.name ?? ex.supplier_name ?? "Unbekannt";
    const entry = supplierTotals.get(name) ?? { grossCents: 0, count: 0 };
    entry.grossCents += gross;
    entry.count += 1;
    supplierTotals.set(name, entry);
  }

  const byDay = Array.from({ length: 7 }, (_, i) => {
    const date = new Date(start + i * DAY).toISOString().slice(0, 10);
    const list = inWeek.filter((r) => localDate(r.mail.date, tz) === date);
    const byCat = Object.fromEntries(CATEGORIES.map((c) => [c, 0])) as Record<Category, number>;
    for (const r of list) byCat[r.category] += 1;
    return { date, count: list.length, byCategory: byCat };
  });

  const count = (s: ProcessedMail["status"]) => inWeek.filter((r) => r.status === s).length;
  const attention = inWeek
    .filter((r) => ["needs_review", "quarantined", "awaiting_approval", "delivery_failed"].includes(r.status))
    .sort((a, b) => a.mail.date.localeCompare(b.mail.date))
    .map((r) => ({
      mailId: r.id,
      subject: r.mail.subject,
      status: r.status,
      reason:
        r.status === "awaiting_approval"
          ? pick(opts.locale, "Antwortentwurf wartet auf Freigabe", "Reply draft awaiting approval")
          : r.status === "delivery_failed"
            ? pick(opts.locale, "Freigegebene Antwort konnte nicht versendet werden", "Approved reply could not be sent")
            : (r.reviewReasons.find((f) => f.severity === "error") ?? r.reviewReasons[0])?.message ?? pick(opts.locale, "Bitte prüfen", "Please check"),
    }));

  return {
    weekStart,
    weekEnd: lastDay,
    isoWeek: isoWeekLabel(weekStart),
    totals: {
      mails: inWeek.length,
      byCategory,
      invoicesFiled: filedInvoices.length,
      invoicesGrossCents: invoicesGross,
      awaitingApproval: count("awaiting_approval"),
      openReview: count("needs_review"),
      quarantined: count("quarantined"),
      sent: inWeek.filter(replySent).length,
      discarded: count("discarded"),
    },
    byDay,
    topSuppliers: [...supplierTotals.entries()]
      .map(([supplier, v]) => ({ supplier, ...v }))
      .sort((a, b) => b.grossCents - a.grossCents)
      .slice(0, 5),
    attention,
  };
}
