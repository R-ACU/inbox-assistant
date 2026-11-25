/** Start dashboard: windows, outcome groups, heatmap slots, open tasks. Pure function over records. */
import { describe, expect, it } from "vitest";
import { buildDashboard, localHour, outcomeOf } from "../src/core/dashboard";
import type { ProcessedMail } from "../src/shared/types";

let n = 0;
function rec(date: string, over: Partial<ProcessedMail> = {}): ProcessedMail {
  n += 1;
  return {
    id: `id${n}`,
    receivedAt: date,
    mail: { date, subject: `Mail ${n}`, from: { name: `Absender ${n}`, address: `a${n}@example.test` } } as ProcessedMail["mail"],
    classification: null,
    category: "other",
    ruleFindings: [],
    invoice: null,
    draft: null,
    status: "filed",
    reviewReasons: [],
    steps: [],
    resumeUrl: null,
    ...over,
  };
}
const invoice = (gross: number) => ({ extraction: { readable: true, gross_total: gross } }) as unknown as ProcessedMail["invoice"];
const draft = {} as ProcessedMail["draft"];
const reason = [{ code: "x", severity: "error" as const, message: "Summe weicht ab" }];

describe("dashboard", () => {
  it("sorts every mail into exactly one outcome group", () => {
    expect(outcomeOf(rec("2026-11-20T10:00:00Z"))).toBe("auto");
    expect(outcomeOf(rec("2026-11-20T10:00:00Z", { draft, status: "awaiting_approval", category: "inquiry" }))).toBe("prepared");
    expect(outcomeOf(rec("2026-11-20T10:00:00Z", { status: "needs_review", reviewReasons: reason, category: "invoice" }))).toBe("review");
    // A review item the owner closed still counts as stopped by the assistant.
    expect(outcomeOf(rec("2026-11-20T10:00:00Z", { status: "resolved", reviewReasons: reason }))).toBe("review");
    expect(outcomeOf(rec("2026-11-20T10:00:00Z", { status: "quarantined", category: "suspicious", reviewReasons: reason }))).toBe("quarantine");
  });

  it("ends the window today and compares with the window before", () => {
    const records = [
      rec("2026-11-24T08:00:00Z", { category: "invoice", invoice: invoice(119), status: "filed" }),
      rec("2026-11-24T20:30:00Z", { category: "inquiry", draft, status: "awaiting_approval" }),
      rec("2026-11-18T09:00:00Z", { status: "quarantined", category: "suspicious", reviewReasons: reason }),
      rec("2026-11-17T09:00:00Z"),
      rec("2026-11-10T09:00:00Z"),
      rec("2026-11-01T09:00:00Z"),
    ];
    const d = buildDashboard(records, 7, "2026-11-24");
    expect(d.range).toEqual({ from: "2026-11-18", to: "2026-11-24", days: 7, previousFrom: "2026-11-11", previousTo: "2026-11-17" });
    expect(d.current).toEqual({ mails: 3, drafts: 1, invoiceGrossCents: 11900, invoices: 1, stopped: 1 });
    expect(d.previous.mails).toBe(1);
    expect(d.days).toHaveLength(7);
    expect(d.days.at(-1)).toMatchObject({ date: "2026-11-24", total: 2, drafts: 1, invoiceGrossCents: 11900 });
    expect(d.days.at(-1)!.byCategory).toEqual({ invoice: 1, inquiry: 1, other: 0, suspicious: 0 });
    expect(d.outcomes).toEqual({ auto: 1, prepared: 1, review: 0, quarantine: 1 });
    expect(d.awaitingApproval).toBe(1);
    expect(d.totalMails).toBe(6);
    expect(buildDashboard(records, 14, "2026-11-24").current.mails).toBe(4);
  });

  it("counts from today, not from the newest mail, so old data shows as old", () => {
    const records = [rec("2026-11-24T08:00:00Z"), rec("2026-11-17T09:00:00Z")];
    const d = buildDashboard(records, 7, "2026-12-30");
    expect(d.range).toMatchObject({ from: "2026-12-24", to: "2026-12-30" });
    expect(d.current.mails).toBe(0);
    expect(d.totalMails).toBe(2);
  });

  it("puts each mail into the hour of its local time", () => {
    // 20:30 UTC is 21:30 in Berlin (winter time).
    expect(localHour("2026-11-24T20:30:00Z")).toBe(21);
    expect(localHour("2026-11-24T23:30:00Z")).toBe(0);
    const d = buildDashboard([rec("2026-11-24T20:30:00Z"), rec("2026-11-24T07:10:00Z")], 7, "2026-11-24");
    expect(d.heatmap).toHaveLength(7);
    expect(d.heatmap[0]).toHaveLength(24);
    expect(d.heatmap[6]![21]).toBe(1);
    expect(d.heatmap[6]![8]).toBe(1);
    expect(d.heatmap.flat().reduce((a, b) => a + b, 0)).toBe(2);
  });

  it("lists open tasks oldest first, with the reason the assistant stopped", () => {
    const d = buildDashboard(
      [
        rec("2026-11-22T10:00:00Z", { status: "needs_review", reviewReasons: reason, category: "invoice" }),
        rec("2026-11-21T10:00:00Z", { status: "awaiting_approval", draft, category: "inquiry" }),
        rec("2026-11-21T09:00:00Z", { status: "sent", draft, category: "inquiry" }),
      ],
      7,
      "2026-11-24",
    );
    expect(d.tasks.map((t) => [t.status, t.reason])).toEqual([
      ["awaiting_approval", "Antwortentwurf wartet auf Freigabe"],
      ["needs_review", "Summe weicht ab"],
    ]);
    expect(d.oldestAwaiting).toBe("2026-11-21T10:00:00Z");
  });

  it("works without any mail", () => {
    const d = buildDashboard([], 7, "2026-11-24");
    expect(d.range.to).toBe("2026-11-24");
    expect(d.current.mails).toBe(0);
    expect(d.tasks).toEqual([]);
  });
});
