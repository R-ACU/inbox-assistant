import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildDashboard } from "../src/core/dashboard";
import type { ProcessedMail } from "../src/shared/types";
import {
  addBusinessDays,
  berlinDate,
  berlinWallToUtc,
  emlDate,
  fixtureMailFiles,
  fixtureShift,
  isBusinessDay,
  planDemoShift,
  shiftedEml,
  withEmlDate,
} from "../scripts/demo-clock";

// Every clock here is fixed, so the result never depends on the day the tests run.
const files = fixtureMailFiles();
const original = files.map((f) => emlDate(readFileSync(f))!);
const wall = (d: Date) => new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", timeStyle: "medium" }).format(d);
const asRecords = (dates: Date[]) =>
  dates.map((d) => ({ mail: { date: d.toISOString() }, category: "other", status: "filed", reviewReasons: [], draft: null }) as unknown as ProcessedMail);

describe("demo clock (seed and preview only)", () => {
  it("reads the Date header of every fixture mail", () => {
    expect(files).toHaveLength(22);
    expect(original.every((d) => d instanceof Date && !Number.isNaN(d.getTime()))).toBe(true);
    expect(original.every((d) => isBusinessDay(berlinDate(d)))).toBe(true);
  });

  it.each([
    ["Wednesday noon", "2026-11-25T12:00:00Z", 1, "2026-11-25"],
    ["Wednesday before the newest mail's time", "2026-11-25T06:00:00Z", 0, "2026-11-24"],
    ["Saturday", "2026-11-28T12:00:00Z", 3, "2026-11-27"],
    ["Sunday", "2026-11-29T12:00:00Z", 3, "2026-11-27"],
    ["Monday", "2026-11-30T12:00:00Z", 4, "2026-11-30"],
    ["months later, summer time", "2027-04-15T12:00:00Z", 102, "2027-04-15"],
  ])("puts the newest mail on the latest business day: %s", (_name, now, businessDays, newestDay) => {
    const plan = planDemoShift(original, new Date(now));
    expect(plan.businessDays).toBe(businessDays);
    const moved = original.map(plan.shift);
    const newest = moved.reduce((a, b) => (b > a ? b : a));
    expect(berlinDate(newest)).toBe(newestDay);
  });

  it("keeps the Berlin time of day, also across the clock change", () => {
    const plan = planDemoShift(original, new Date("2027-04-15T12:00:00Z"));
    for (const d of original) expect(wall(plan.shift(d))).toBe(wall(d));
    expect(berlinWallToUtc("2027-04-15", "09:05:00").toISOString()).toBe("2027-04-15T07:05:00.000Z");
    expect(berlinWallToUtc("2026-11-24", "09:05:00").toISOString()).toBe("2026-11-24T08:05:00.000Z");
  });

  it("keeps order, gaps in business days and empty weekends across a year", () => {
    const week = (dates: Date[], days: 7 | 14, today: string) => buildDashboard(asRecords(dates), days, today).current.mails;
    const originalWeek = week(original, 7, "2026-11-24");
    const originalFortnight = week(original, 14, "2026-11-24");
    expect([originalWeek, originalFortnight]).toEqual([15, 22]);
    const order = original.map((_, i) => i).sort((a, b) => original[a]!.getTime() - original[b]!.getTime());
    const problems: string[] = [];
    // Every third day for 400 days hits each weekday many times; three times of day each.
    for (let day = 0; day < 400; day += 3) {
      for (const hour of [5, 13, 22]) {
        const now = new Date(Date.UTC(2026, 10, 25 + day, hour, 30));
        const plan = planDemoShift(original, now);
        const moved = original.map(plan.shift);
        const at = now.toISOString();
        if (!moved.every((d) => d.getTime() <= now.getTime())) problems.push(`${at}: mail in the future`);
        if (!moved.every((d) => isBusinessDay(berlinDate(d)))) problems.push(`${at}: mail on a weekend`);
        for (let i = 1; i < order.length; i += 1) {
          if (moved[order[i]!]!.getTime() < moved[order[i - 1]!]!.getTime()) problems.push(`${at}: order changed`);
        }
        for (const [i, d] of original.entries()) {
          if (berlinDate(moved[i]!) !== addBusinessDays(berlinDate(d), plan.businessDays)) problems.push(`${at}: gap changed (${i})`);
        }
        // The overview counts from today: the same mails fall into the last 7 and 14 days every time,
        // except early on a business day before the newest mail's time, when that day has no mail yet.
        const today = berlinDate(now);
        const early = isBusinessDay(today) && berlinDate(moved.reduce((a, b) => (b > a ? b : a))) !== today;
        const expected = early ? [week(original, 7, "2026-11-25"), week(original, 14, "2026-11-25")] : [originalWeek, originalFortnight];
        const got = [week(moved, 7, today), week(moved, 14, today)];
        if (got.join() !== expected.join()) problems.push(`${at}: overview ${got.join("/")} instead of ${expected.join("/")}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("moves a weekend mail by calendar days if a data set has one", () => {
    const dates = [new Date("2026-11-21T10:00:00Z"), new Date("2026-11-24T08:00:00Z")];
    const plan = planDemoShift(dates, new Date("2026-12-02T12:00:00Z"));
    expect(berlinDate(plan.shift(dates[1]!))).toBe("2026-12-02");
    expect(berlinDate(plan.shift(dates[0]!))).toBe("2026-11-29");
  });

  it("only replaces the Date header of a raw mail", () => {
    const raw = readFileSync(files[0]!);
    const moved = withEmlDate(raw, new Date("2027-01-05T06:42:00Z"));
    expect(emlDate(moved)!.toISOString()).toBe("2027-01-05T06:42:00.000Z");
    expect(moved.toString("latin1")).toContain("Date: Tue, 05 Jan 2027 06:42:00 +0000");
    expect(moved.toString("latin1").replace(/^Date:.*$/m, "")).toBe(raw.toString("latin1").replace(/^Date:.*$/m, ""));
    const viaPlan = shiftedEml(raw, fixtureShift(new Date("2026-11-24T12:00:00Z")));
    expect(viaPlan.equals(raw)).toBe(true);
  });
});
