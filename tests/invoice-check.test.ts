import { describe, expect, it } from "vitest";
import { germanIban, isValidIban } from "../src/core/iban";
import { checkInvoice, findLookalike, findSupplier, type InvoiceCheckContext } from "../src/core/invoice-check";
import { lineCents, taxCents, toCents } from "../src/core/money";
import type { InvoiceExtraction } from "../src/shared/schemas";
import { SUPPLIERS, TENANT } from "../src/tenant/profile";

const ctx: InvoiceCheckContext = { today: "2026-11-24", suppliers: TENANT.suppliers, existing: [] };

function invoice(overrides: Partial<InvoiceExtraction> = {}): InvoiceExtraction {
  return {
    readable: true,
    unreadable_reason: null,
    supplier_name: SUPPLIERS.nordlicht.name,
    invoice_number: "RE-1",
    invoice_date: "2026-11-13",
    iban: SUPPLIERS.nordlicht.iban,
    currency: "EUR",
    line_items: [
      { description: "Farbe", quantity: 8, unit_price: 64.9, line_total: 519.2 },
      { description: "Grund", quantity: 3, unit_price: 38.5, line_total: 115.5 },
      { description: "Folie", quantity: 20, unit_price: 2.95, line_total: 59 },
    ],
    net_total: 693.7,
    tax_rate_percent: 19,
    tax_total: 131.8,
    gross_total: 825.5,
    ...overrides,
  };
}

const codes = (ex: InvoiceExtraction, c = ctx) => checkInvoice(ex, c).findings.map((f) => f.code);

describe("money", () => {
  it("multiplies without float noise", () => {
    expect(lineCents(3, 0.1)).toBe(30);
    expect(lineCents(20, 2.95)).toBe(5900);
    expect(lineCents(2.5, 2.4995)).toBe(625);
  });
  it("rounds tax half away from zero", () => {
    expect(taxCents(46550, 19)).toBe(8845); // 88.445 -> 88.45
    expect(taxCents(-46550, 19)).toBe(-8845);
    expect(taxCents(64240, 19)).toBe(12206);
  });
  it("converts decimals to cents", () => {
    expect(toCents(1190)).toBe(119000);
    expect(toCents(0.1 + 0.2)).toBe(30);
    expect(toCents(null)).toBeNull();
    expect(toCents(Number.NaN)).toBeNull();
  });
});

describe("iban", () => {
  it("accepts the canonical example and generated test IBANs", () => {
    expect(isValidIban("DE89 3704 0044 0532 0130 00")).toBe(true);
    for (const s of Object.values(SUPPLIERS)) expect(isValidIban(s.iban)).toBe(true);
    expect(isValidIban(germanIban("12345678", "1"))).toBe(true);
  });
  it("rejects a single changed digit", () => {
    expect(isValidIban("DE89 3704 0044 0532 0130 01")).toBe(false);
    expect(isValidIban("DE02 3704 0044 0999 8877 66")).toBe(false);
    expect(isValidIban("not an iban")).toBe(false);
  });
});

describe("checkInvoice", () => {
  it("passes a correct invoice and reports the recomputed totals", () => {
    const res = checkInvoice(invoice(), ctx);
    expect(res.ok).toBe(true);
    expect(res.findings).toEqual([]);
    expect(res.computed).toEqual({ lineSum: 69370, expectedTax: 13180, expectedGross: 82550 });
    expect(res.supplier?.name).toBe(SUPPLIERS.nordlicht.name);
  });

  it("flags printed net that differs from the sum of the lines (the 1,190 EUR case)", () => {
    const ex = invoice({
      line_items: [
        { description: "Innenputz", quantity: 20, unit_price: 12.9, line_total: 258 },
        { description: "Gewebe", quantity: 10, unit_price: 31.5, line_total: 315 },
        { description: "Kran", quantity: 1, unit_price: 410.19, line_total: 410.19 },
      ],
      net_total: 1000,
      tax_total: 190,
      gross_total: 1190,
    });
    const res = checkInvoice(ex, ctx);
    expect(res.ok).toBe(false);
    expect(res.findings.map((f) => f.code)).toEqual(["net_sum_mismatch"]);
    expect(res.findings[0]!.message).toContain("983,19");
    expect(res.computed?.expectedGross).toBe(117000); // positions add up to 1.170,00 EUR gross
  });

  it("flags a wrong line total", () => {
    const ex = invoice();
    ex.line_items[0]!.line_total = 529.2;
    expect(codes(ex)).toContain("line_total_mismatch");
  });

  it("tolerates one cent of tax rounding but not more", () => {
    expect(codes(invoice({ tax_total: 131.81, gross_total: 825.51 }))).toEqual([]);
    expect(codes(invoice({ tax_total: 131.85, gross_total: 825.55 }))).toContain("tax_mismatch");
  });

  it("flags gross that is not net plus tax", () => {
    expect(codes(invoice({ gross_total: 852.5 }))).toEqual(["gross_mismatch"]);
  });

  it("flags unusual tax rates", () => {
    expect(codes(invoice({ tax_rate_percent: 16, tax_total: 110.99, gross_total: 804.69 }))).toContain("unusual_tax_rate");
  });

  it("sends unreadable documents to review without further checks", () => {
    const res = checkInvoice(invoice({ readable: false, unreadable_reason: "Scan unscharf" }), ctx);
    expect(res.ok).toBe(false);
    expect(res.findings.map((f) => f.code)).toEqual(["unreadable"]);
    expect(res.findings[0]!.message).toContain("Scan unscharf");
  });

  it("requires the mandatory fields", () => {
    const res = checkInvoice(invoice({ invoice_number: null, gross_total: null }), ctx);
    expect(res.findings.filter((f) => f.code === "missing_field")).toHaveLength(2);
    expect(res.ok).toBe(false);
  });

  it("detects a changed bank account for a known supplier", () => {
    const other = germanIban("37040044", "999887766");
    const res = checkInvoice(invoice({ iban: other }), ctx);
    expect(res.findings.map((f) => f.code)).toEqual(["iban_changed"]);
  });

  it("detects an invalid IBAN checksum", () => {
    expect(codes(invoice({ iban: "DE02 3704 0044 0999 8877 66" }))).toEqual(["invalid_iban"]);
  });

  it("detects duplicates by supplier and invoice number", () => {
    const c = { ...ctx, existing: [{ supplier: "Farbenhaus Nordlicht", invoiceNumber: "RE-1" }] };
    expect(codes(invoice(), c)).toEqual(["duplicate_invoice"]);
  });

  it("checks the invoice date against today", () => {
    expect(codes(invoice({ invoice_date: "2026-12-01" }))).toEqual(["date_in_future"]);
    expect(codes(invoice({ invoice_date: "2025-06-01" }))).toEqual(["date_too_old"]);
    expect(checkInvoice(invoice({ invoice_date: "2025-06-01" }), ctx).ok).toBe(true); // warning only
  });

  it("only files invoices in EUR", () => {
    expect(codes(invoice({ currency: "USD" }))).toContain("currency");
  });

  it("never files an unknown supplier: unknown_supplier is an error", () => {
    const res = checkInvoice(invoice({ supplier_name: "Neue Firma GmbH", iban: null }), ctx);
    expect(res.findings.map((f) => f.code)).toEqual(["unknown_supplier"]);
    expect(res.ok).toBe(false);
  });

  // Regression (security review S-A1): a look-alike name with a valid foreign IBAN and
  // correct totals used to pass as "unknown supplier, warning" and was filed automatically.
  it("flags a look-alike of a known supplier with a foreign IBAN", () => {
    const res = checkInvoice(
      invoice({ supplier_name: "Farbenhaus Nordlichtt GmbH", iban: germanIban("50010517", "5407324339") }),
      { ...ctx, senderAddress: "rechnung@farbenhaus-nordlichtt.example" },
    );
    expect(res.ok).toBe(false);
    expect(res.findings.map((f) => f.code)).toEqual(["supplier_lookalike"]);
    expect(res.findings[0]!.message).toContain("Farbenhaus Nordlicht GmbH");
  });

  it("flags a known supplier name sent from a foreign domain", () => {
    const ok = checkInvoice(invoice(), { ...ctx, senderAddress: "rechnung@farbenhaus-nordlicht.example" });
    expect(ok.findings).toEqual([]);
    const sub = checkInvoice(invoice(), { ...ctx, senderAddress: "rechnung@mail.farbenhaus-nordlicht.example" });
    expect(sub.findings).toEqual([]);
    const foreign = checkInvoice(invoice(), { ...ctx, senderAddress: "rechnung@farbenhaus-nordlicht-zahlung.example" });
    expect(foreign.findings.map((f) => f.code)).toEqual(["sender_domain_mismatch"]);
    expect(foreign.ok).toBe(false);
  });

  it("matches supplier names regardless of legal form and punctuation", () => {
    expect(findSupplier("Baustoffe Lenz GmbH & Co. KG", TENANT.suppliers)?.name).toBe(SUPPLIERS.lenz.name);
    expect(findSupplier("BAUSTOFFE LENZ", TENANT.suppliers)?.name).toBe(SUPPLIERS.lenz.name);
    expect(findSupplier("Baustoffe Lentz", TENANT.suppliers)).toBeNull();
    expect(findLookalike("Baustoffe Lentz", TENANT.suppliers)?.name).toBe(SUPPLIERS.lenz.name);
    expect(findLookalike("Malerbetrieb Schulze", TENANT.suppliers)).toBeNull();
  });
});
