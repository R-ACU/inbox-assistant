/**
 * Moves the invented test mails to the present, for the seed and the preview only.
 *
 * The fixtures keep their fixed dates (they are reproducible byte for byte and the
 * eval runs on them). When the demo database is filled, every mail is moved by the
 * same number of business days, so the newest mail arrives on the latest business
 * day that is not in the future. The time of day (Berlin), the order, the gaps in
 * business days and the rule "no mail on a weekend" stay as they are in the fixtures.
 * The app itself never shifts a date; it only sees mails with these Date headers.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DAY = 86_400_000;
const TIME_ZONE = "Europe/Berlin";
const berlin = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function parts(d: Date) {
  const p = Object.fromEntries(berlin.formatToParts(d).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}:${p.second}` };
}

/** Calendar day (YYYY-MM-DD) in Berlin. */
export function berlinDate(d: Date): string {
  return parts(d).date;
}

/** Berlin wall-clock time on a given day as an instant, correct across the clock change. */
export function berlinWallToUtc(date: string, time: string): Date {
  const naive = Date.parse(`${date}T${time}Z`);
  const offset = (t: number) => {
    const p = parts(new Date(t));
    return Date.parse(`${p.date}T${p.time}Z`) - t;
  };
  const first = naive - offset(naive);
  return new Date(naive - offset(first));
}

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T12:00:00Z`) + days * DAY).toISOString().slice(0, 10);
}

export function isBusinessDay(date: string): boolean {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  return day !== 0 && day !== 6;
}

/** Moves a business day by n business days (n may be negative). */
export function addBusinessDays(date: string, n: number): string {
  let d = date;
  const step = n < 0 ? -1 : 1;
  for (let left = Math.abs(n); left > 0; ) {
    d = addDays(d, step);
    if (isBusinessDay(d)) left -= 1;
  }
  return d;
}

/** Signed number of business days from one business day to another. */
export function businessDaysBetween(from: string, to: string): number {
  if (from === to) return 0;
  const step = to > from ? 1 : -1;
  let n = 0;
  for (let d = from; d !== to; ) {
    d = addDays(d, step);
    if (isBusinessDay(d)) n += step;
  }
  return n;
}

export interface DemoShift {
  /** Business days every mail is moved by (0 when the fixtures already end today). */
  businessDays: number;
  /** Calendar days the newest mail is moved by. */
  calendarDays: number;
  shift(date: Date): Date;
}

/**
 * Plans the move for a set of mail dates. Pass `now` explicitly; tests fix it.
 * Mails on business days move by business days (weekends stay empty), a mail on a
 * weekend, if a data set has one, moves by the calendar days of the newest mail.
 */
export function planDemoShift(dates: Date[], now: Date): DemoShift {
  if (dates.length === 0) return { businessDays: 0, calendarDays: 0, shift: (d) => d };
  const newest = dates.reduce((a, b) => (b.getTime() > a.getTime() ? b : a));
  const { date: newestDay, time: newestTime } = parts(newest);
  const newestBusiness = isBusinessDay(newestDay);

  // Latest day that keeps the pattern and does not put the newest mail in the future.
  let target = berlinDate(now);
  for (;;) {
    if ((!newestBusiness || isBusinessDay(target)) && berlinWallToUtc(target, newestTime).getTime() <= now.getTime()) break;
    target = addDays(target, -1);
  }
  const calendarDays = Math.round((Date.parse(`${target}T12:00:00Z`) - Date.parse(`${newestDay}T12:00:00Z`)) / DAY);
  const businessDays = newestBusiness ? businessDaysBetween(newestDay, target) : 0;

  const shift = (d: Date) => {
    const p = parts(d);
    const day = newestBusiness && isBusinessDay(p.date) ? addBusinessDays(p.date, businessDays) : addDays(p.date, calendarDays);
    return berlinWallToUtc(day, p.time);
  };
  return { businessDays, calendarDays, shift };
}

const HEADER_END = /\r?\n\r?\n/;
const DATE_HEADER = /^Date:[^\r\n]*(?:\r?\n[ \t][^\r\n]*)*/im;

/** Reads the Date header of a raw mail (null if it has none). */
export function emlDate(raw: Buffer): Date | null {
  const text = raw.toString("latin1");
  const head = text.split(HEADER_END, 1)[0]!;
  const m = DATE_HEADER.exec(head);
  if (!m) return null;
  const d = new Date(m[0].slice(5).replace(/\s+/g, " ").trim());
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Returns the raw mail with its Date header replaced; every other byte stays the same. */
export function withEmlDate(raw: Buffer, date: Date): Buffer {
  const text = raw.toString("latin1");
  const end = HEADER_END.exec(text)?.index ?? text.length;
  const head = text.slice(0, end);
  if (!DATE_HEADER.test(head)) throw new Error("Mail has no Date header");
  const value = date.toUTCString().replace("GMT", "+0000");
  return Buffer.from(head.replace(DATE_HEADER, `Date: ${value}`) + text.slice(end), "latin1");
}

/** All fixture mails (test set plus demo extras), as file paths. */
export function fixtureMailFiles(root = process.cwd()): string[] {
  const dir = join(root, "fixtures", "mails");
  const extra = join(dir, "extra");
  const list = (d: string) => readdirSync(d).filter((f) => f.endsWith(".eml")).map((f) => join(d, f));
  let extras: string[] = [];
  try {
    extras = list(extra);
  } catch {
    extras = [];
  }
  return [...list(dir), ...extras];
}

/**
 * The move for the whole fixture set, so the seed, `--skip` and a mail sent later
 * through n8n all land on the same days.
 */
export function fixtureShift(now: Date, root = process.cwd()): DemoShift {
  const dates = fixtureMailFiles(root)
    .map((f) => emlDate(readFileSync(f)))
    .filter((d): d is Date => d !== null);
  return planDemoShift(dates, now);
}

/** A raw mail moved to the present, unchanged if it has no readable Date header. */
export function shiftedEml(raw: Buffer, shift: DemoShift): Buffer {
  const date = emlDate(raw);
  return date ? withEmlDate(raw, shift.shift(date)) : raw;
}
