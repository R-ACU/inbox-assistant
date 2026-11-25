import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkDraft } from "../src/core/draft-check";
import { computeTcv, reconcile } from "../src/core/reconcile";
import { sha256 } from "../src/mail/parse";
import type { ContractExtraction } from "../src/shared/schemas";
import { TENANT } from "../src/tenant/profile";
import { FIXTURES, loadResponses } from "./helpers";

const ctx = { faq: TENANT.faq, mailText: "Wir haben 85 m² Wandfläche.", allowedDomains: [TENANT.domain] };
const draft = (body: string, used = ["preise"]) => ({ subject: "Re: x", body, used_faq_ids: used, open_questions: [] });
const codes = (body: string, used?: string[]) => checkDraft(draft(body, used), ctx).map((f) => f.code);
const padding = " Wir melden uns gern mit einem Terminvorschlag bei Ihnen. Viele Grüße aus Lindenfeld.";

describe("checkDraft", () => {
  it("accepts facts that come from the used FAQ entry or the mail", () => {
    expect(codes(`Richtwert ab 9 € pro m², bei Ihren 85 m² also ein guter Anfang.${padding}`)).toEqual([]);
  });

  it("flags numbers that appear nowhere in the sources", () => {
    expect(codes(`Samstags mit 25 % Zuschlag, ab 7,50 € pro m².${padding}`)).toEqual(["unsupported_fact"]);
  });

  it("does not let a fact from an unused FAQ entry count", () => {
    // 45 EUR is in "einzugsgebiet", but the draft only claims to use "preise".
    expect(codes(`Die Anfahrt kostet 45 € pro Tag.${padding}`)).toEqual(["unsupported_fact"]);
  });

  it("flags unknown FAQ ids, foreign links, bank details and empty FAQ use", () => {
    expect(codes(`Siehe FAQ.${padding}`, ["preise", "erfunden"])).toContain("unknown_faq");
    expect(codes(`Mehr unter https://evil.example/x.${padding}`)).toContain("foreign_link");
    expect(codes(`Mehr unter https://hofmann-kraft.example/leistungen.${padding}`)).not.toContain("foreign_link");
    expect(codes(`Bitte zahlen an DE89 3704 0044 0532 0130 00.${padding}`)).toContain("bank_details");
    expect(codes(`Danke für Ihre Anfrage.${padding}`, [])).toEqual(["no_faq"]);
  });

  // Regression (security review S-A7): a substring match let look-alike hosts through.
  it("judges links by their real host, not by a substring", () => {
    expect(codes(`Mehr unter https://evil.test/?ref=hofmann-kraft.example.${padding}`)).toContain("foreign_link");
    expect(codes(`Mehr unter https://hofmann-kraft.example.evil.test/x.${padding}`)).toContain("foreign_link");
    expect(codes(`Mehr unter https://www.hofmann-kraft.example/preise.${padding}`)).not.toContain("foreign_link");
    expect(codes(`Mehr unter www.hofmann-kraft.example.${padding}`)).not.toContain("foreign_link");
  });

  // Regression (security review S-A7): dates, times and "2400,-" were not checked at all.
  it.each([
    ["date", "Wir kommen am 03.12. zur Besichtigung."],
    ["time", "Wir sind um 7:30 Uhr bei Ihnen."],
    ["price without unit", "Als Festpreis bieten wir 2400,- an."],
    ["hours", "Die Arbeit dauert etwa 6 Stunden."],
  ])("flags an invented %s", (_label, sentence) => {
    expect(codes(`${sentence}${padding}`)).toContain("unsupported_fact");
  });

  it("accepts dates and times that come from the customer's mail, and ignores the signature", () => {
    const c = { ...ctx, mailText: "Passt es am 03.12. um 7:30 Uhr?", signature: TENANT.signature };
    const body = `Ja, der 03.12. um 7:30 Uhr passt, Richtwert ab 9 € pro m².${padding}\n\n${TENANT.signature}`;
    expect(checkDraft(draft(body), c).map((f) => f.code)).toEqual([]);
  });

  it("turns open questions into info findings for the owner", () => {
    const res = checkDraft({ ...draft(`Danke.${padding}`), open_questions: ["Adresse fehlt"] }, ctx);
    expect(res).toEqual([{ code: "open_question", severity: "info", message: "Vor dem Senden klären: Adresse fehlt" }]);
  });
});

describe("reconcile", () => {
  const pairs = JSON.parse(readFileSync(join(FIXTURES, "contracts", "pairs.json"), "utf8")) as {
    id: string;
    quote: string;
    order: string;
    expectedDiscrepancies: number;
  }[];
  const contracts = loadResponses().contract as Record<string, ContractExtraction>;
  const load = (file: string) => contracts[sha256(readFileSync(join(FIXTURES, "contracts", file)))]!;

  it.each(pairs.map((p) => [p.id, p] as const))("finds the expected discrepancies in %s", (_id, pair) => {
    const res = reconcile(load(pair.quote), load(pair.order));
    expect(res.discrepancyCount).toBe(pair.expectedDiscrepancies);
  });

  it("writes a clean English note for a matching pair", () => {
    const pair = pairs.find((p) => p.id === "riverside")!;
    const res = reconcile(load(pair.quote), load(pair.order));
    expect(res.note).toContain("Result: no discrepancies");
    expect(res.computed.orderTcvCents).toBe(8_874_720);
  });

  it("lists each discrepancy in the note, including a total that does not match its own lines", () => {
    const pair = pairs.find((p) => p.id === "northgate")!;
    const res = reconcile(load(pair.quote), load(pair.order));
    expect(res.note).toContain("Payment terms: quote Net 30, order form Net 45.");
    expect(res.note).toContain("Line PRV-SEAT (Provider seat, EHR platform): quantity 12 in quote, 14 on order form.");
    expect(res.note).toContain("Line SUP-PREM (Premium support, 24/7): discount 0% in quote, 10% on order form.");
    expect(res.note).toContain("Order form total vs. its line items: stated $268,920.00, line items add up to $214,365.60.");
    expect(res.note).not.toMatch(/[\u2013\u2014]/);
  });

  it("reports lines that exist only on one side and a wrong quote reference", () => {
    const pair = pairs.find((p) => p.id === "lakeside")!;
    const res = reconcile(load(pair.quote), load(pair.order));
    expect(res.lines.find((l) => l.sku === "RCM-ADDON")?.status).toBe("only_in_quote");
    expect(res.fields.find((f) => f.key === "quote_reference")?.status).toBe("mismatch");
    expect(res.fields.find((f) => f.key === "auto_renewal")).toMatchObject({ quote: "yes", order: "no", status: "mismatch" });
  });

  it("marks missing fields and unreadable documents", () => {
    const pair = pairs.find((p) => p.id === "riverside")!;
    const order = { ...load(pair.order), readable: false, payment_terms_days: null };
    const res = reconcile(load(pair.quote), order);
    expect(res.fields.find((f) => f.key === "payment_terms")?.status).toBe("missing");
    expect(res.note).toContain("The order form could not be read reliably.");
    expect(res.discrepancyCount).toBe(2);
  });

  it("computes the total contract value in cents", () => {
    const doc = load(pairs[0]!.quote);
    expect(computeTcv(doc)).toBe(8_874_720);
    expect(computeTcv({ ...doc, term_months: null })).toBeNull();
  });
});
