/**
 * Start dashboard, computed from stored records. Pure function, no I/O.
 * Every number comes from the records; nothing is estimated or filled in.
 * The window ends today (the caller passes the business's calendar day).
 */
import { pick, type Locale } from "../shared/locale";
import { CATEGORIES, type Category } from "../shared/schemas";
import type { DashboardData, DashboardOutcome, ProcessedMail } from "../shared/types";
import { toCents } from "./money";
import { settledStatus } from "./reply";
import { DEFAULT_TIME_ZONE, localDate } from "./weekly";

const DAY = 86_400_000;
const hourFormats = new Map<string, Intl.DateTimeFormat>();

/** Hour of the day (0 to 23) in the business's time zone. */
export function localHour(iso: string, timeZone = DEFAULT_TIME_ZONE): number {
  let format = hourFormats.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", hourCycle: "h23" });
    hourFormats.set(timeZone, format);
  }
  return Number(format.format(new Date(iso))) % 24;
}

function addDays(dateIso: string, days: number): string {
  return new Date(new Date(`${dateIso}T12:00:00Z`).getTime() + days * DAY).toISOString().slice(0, 10);
}

/**
 * How the assistant handled a mail on its own. Each record falls into exactly one group, checked in this
 * order. A reply the owner asked for later is his work, not the assistant's: it changes nothing here.
 */
export function outcomeOf(r: ProcessedMail): DashboardOutcome {
  const status = settledStatus(r);
  if (r.category === "suspicious" || status === "quarantined") return "quarantine";
  if (r.reviewReasons.length > 0 || status === "needs_review") return "review";
  if (r.draft && !r.draft.requested) return "prepared";
  return "auto";
}

/** A reply draft the intake wrote (not one the owner asked for). */
const intakeDraft = (r: ProcessedMail) => r.draft !== null && !r.draft.requested;

/** A mail the assistant stopped instead of passing on: quarantine or the review list. */
const stopped = (r: ProcessedMail) => {
  const o = outcomeOf(r);
  return o === "quarantine" || o === "review";
};

const invoiceGross = (r: ProcessedMail) =>
  r.category === "invoice" && r.invoice?.extraction.readable ? (toCents(r.invoice.extraction.gross_total) ?? 0) : 0;

const OPEN = new Set<ProcessedMail["status"]>(["awaiting_approval", "needs_review", "quarantined", "delivery_failed"]);

export function buildDashboard(
  records: ProcessedMail[],
  days: 7 | 14,
  today: string,
  opts: { timeZone?: string; locale?: Locale } = {},
): DashboardData {
  const tz = opts.timeZone ?? DEFAULT_TIME_ZONE;
  const to = today;
  const from = addDays(to, -(days - 1));
  const prevFrom = addDays(from, -days);
  const prevTo = addDays(from, -1);

  const byDate = new Map<string, ProcessedMail[]>();
  for (const r of records) {
    const d = localDate(r.mail.date, tz);
    byDate.set(d, [...(byDate.get(d) ?? []), r]);
  }
  const inRange = (a: string, b: string) => records.filter((r) => {
    const d = localDate(r.mail.date, tz);
    return d >= a && d <= b;
  });
  const current = inRange(from, to);
  const previous = inRange(prevFrom, prevTo);

  const dayList = Array.from({ length: days }, (_, i) => {
    const date = addDays(from, i);
    const list = byDate.get(date) ?? [];
    const byCategory = Object.fromEntries(CATEGORIES.map((c) => [c, 0])) as Record<Category, number>;
    for (const r of list) byCategory[r.category] += 1;
    return {
      date,
      total: list.length,
      byCategory,
      drafts: list.filter(intakeDraft).length,
      invoiceGrossCents: list.reduce((sum, r) => sum + invoiceGross(r), 0),
      stopped: list.filter(stopped).length,
    };
  });

  const sumOf = (list: ProcessedMail[]) => ({
    mails: list.length,
    drafts: list.filter(intakeDraft).length,
    invoiceGrossCents: list.reduce((sum, r) => sum + invoiceGross(r), 0),
    invoices: list.filter((r) => invoiceGross(r) > 0).length,
    stopped: list.filter(stopped).length,
  });

  const outcomes: Record<DashboardOutcome, number> = { auto: 0, prepared: 0, review: 0, quarantine: 0 };
  for (const r of current) outcomes[outcomeOf(r)] += 1;

  // One row per day of the window, one column per hour of the day (local time).
  const heatmap = dayList.map((d) => {
    const row = Array.from({ length: 24 }, () => 0);
    for (const r of byDate.get(d.date) ?? []) row[localHour(r.mail.date, tz)]! += 1;
    return row;
  });

  const awaiting = records.filter((r) => r.status === "awaiting_approval");
  const oldestAwaiting = awaiting.reduce<string | null>((min, r) => (min === null || r.mail.date < min ? r.mail.date : min), null);

  const tasks = records
    .filter((r) => OPEN.has(r.status))
    .sort((a, b) => a.mail.date.localeCompare(b.mail.date))
    .map((r) => ({
      mailId: r.id,
      subject: r.mail.subject,
      from: r.mail.from.name || r.mail.from.address,
      date: r.mail.date,
      category: r.category,
      status: r.status,
      reason:
        r.status === "awaiting_approval"
          ? pick(opts.locale, "Antwortentwurf wartet auf Freigabe", "Reply draft awaiting approval")
          : r.status === "delivery_failed"
            ? pick(opts.locale, "Freigegebene Antwort wurde nicht versendet", "Approved reply was not sent")
            : ((r.reviewReasons.find((f) => f.severity === "error") ?? r.reviewReasons[0])?.message ?? pick(opts.locale, "Bitte prüfen", "Please check")),
    }));

  const recent = [...current]
    .sort((a, b) => a.mail.date.localeCompare(b.mail.date))
    .map((r) => ({ mailId: r.id, date: r.mail.date, subject: r.mail.subject, outcome: outcomeOf(r) }));

  return {
    range: { from, to, days, previousFrom: prevFrom, previousTo: prevTo },
    current: sumOf(current),
    previous: sumOf(previous),
    awaitingApproval: awaiting.length,
    oldestAwaiting,
    days: dayList,
    outcomes,
    heatmap,
    tasks,
    recent,
    totalMails: records.length,
  };
}
