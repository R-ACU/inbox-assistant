/**
 * Reconciliation mode: compares a signed order form against the quote it is
 * based on. The model only extracts fields from each PDF; the comparison, the
 * recalculated totals and the English note are all produced here in code.
 */
import type { ContractExtraction, ContractLine } from "../shared/schemas";
import type { Cents, ReconcileField, ReconcileLine, ReconcileResult } from "../shared/types";
import { formatMoneyEn, toCents } from "./money";

function norm(value: string | null): string {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function show(value: unknown): string {
  if (value === null || value === undefined || value === "") return "not found";
  if (typeof value === "boolean") return value ? "yes" : "no";
  return String(value);
}

/** Monthly amount of one line after discount, in cents. */
export function lineMonthlyCents(line: ContractLine): Cents {
  const unit = Math.round(line.unit_price * 100);
  return Math.round((line.quantity * unit * (100 - line.discount_percent)) / 100);
}

/** Total contract value recomputed from the line items and the term. */
export function computeTcv(doc: ContractExtraction): Cents | null {
  if (doc.term_months === null || doc.line_items.length === 0) return null;
  return doc.line_items.reduce((sum, l) => sum + lineMonthlyCents(l), 0) * doc.term_months;
}

function compareField(
  key: string,
  label: string,
  quote: unknown,
  order: unknown,
  equal: (a: unknown, b: unknown) => boolean = (a, b) => a === b,
): ReconcileField {
  const missing = quote === null || quote === undefined || order === null || order === undefined;
  return {
    key,
    label,
    quote: show(quote),
    order: show(order),
    status: missing ? "missing" : equal(quote, order) ? "match" : "mismatch",
  };
}

function compareLines(quote: ContractLine[], order: ContractLine[], currency: string | null): ReconcileLine[] {
  const money = (v: number) => formatMoneyEn(Math.round(v * 100), currency);
  const bySku = (lines: ContractLine[]) => new Map(lines.map((l) => [norm(l.sku), l]));
  const q = bySku(quote);
  const o = bySku(order);
  const skus = [...new Set([...q.keys(), ...o.keys()])];
  return skus.map((sku) => {
    const ql = q.get(sku) ?? null;
    const ol = o.get(sku) ?? null;
    const view = (l: ContractLine | null) =>
      l ? { quantity: l.quantity, unitPrice: money(l.unit_price), discount: `${l.discount_percent}%` } : null;
    const base = {
      sku: (ql ?? ol)!.sku,
      description: (ql ?? ol)!.description,
      quote: view(ql),
      order: view(ol),
    };
    if (!ql) return { ...base, status: "only_in_order", differences: ["line is on the order form but not in the quote"] };
    if (!ol) return { ...base, status: "only_in_quote", differences: ["line is in the quote but missing on the order form"] };
    const differences: string[] = [];
    if (ql.quantity !== ol.quantity) differences.push(`quantity ${ql.quantity} in quote, ${ol.quantity} on order form`);
    if (Math.round(ql.unit_price * 100) !== Math.round(ol.unit_price * 100)) {
      differences.push(`unit price ${money(ql.unit_price)} in quote, ${money(ol.unit_price)} on order form`);
    }
    if (ql.discount_percent !== ol.discount_percent) {
      differences.push(`discount ${ql.discount_percent}% in quote, ${ol.discount_percent}% on order form`);
    }
    return { ...base, status: differences.length ? "mismatch" : "match", differences };
  });
}

export function reconcile(quote: ContractExtraction, order: ContractExtraction): ReconcileResult {
  const currency = order.currency ?? quote.currency;
  const money = (c: Cents | null) => (c === null ? null : formatMoneyEn(c, currency));
  const sameText = (a: unknown, b: unknown) => norm(String(a)) === norm(String(b));
  const terms = (d: number | null) => (d === null ? null : `Net ${d}`);

  const quoteTcv = computeTcv(quote);
  const orderTcv = computeTcv(order);
  const printedQuoteTcv = toCents(quote.total_contract_value);
  const printedOrderTcv = toCents(order.total_contract_value);

  const fields: ReconcileField[] = [
    compareField("customer", "Customer", quote.customer_name, order.customer_name, sameText),
    compareField("quote_reference", "Quote reference", quote.document_number, order.quote_reference, sameText),
    compareField("currency", "Currency", quote.currency, order.currency),
    compareField("start_date", "Start date", quote.start_date, order.start_date),
    compareField("term", "Term (months)", quote.term_months, order.term_months),
    compareField("billing", "Billing frequency", quote.billing_frequency, order.billing_frequency),
    compareField("payment_terms", "Payment terms", terms(quote.payment_terms_days), terms(order.payment_terms_days)),
    compareField("auto_renewal", "Auto-renewal", quote.auto_renewal, order.auto_renewal),
    compareField("tcv", "Total contract value", money(printedQuoteTcv), money(printedOrderTcv)),
  ];

  // A stated total that does not match its own line items is a discrepancy even if both documents agree.
  for (const [label, printed, computed, side] of [
    ["Quote total vs. its line items", printedQuoteTcv, quoteTcv, "quote"],
    ["Order form total vs. its line items", printedOrderTcv, orderTcv, "order"],
  ] as const) {
    if (printed !== null && computed !== null && printed !== computed) {
      const text = `stated ${money(printed)}, line items add up to ${money(computed)}`;
      fields.push({
        key: `tcv_check_${side}`,
        label,
        quote: side === "quote" ? text : "",
        order: side === "order" ? text : "",
        status: "mismatch",
      });
    }
  }

  const lines = compareLines(quote.line_items, order.line_items, currency);
  const badFields = fields.filter((f) => f.status !== "match");
  const badLines = lines.filter((l) => l.status !== "match");
  const unreadable = [quote, order].filter((d) => !d.readable).length;
  const discrepancyCount = badFields.length + badLines.length + unreadable;

  const result: ReconcileResult = {
    quote,
    order,
    fields,
    lines,
    computed: { quoteTcvCents: quoteTcv, orderTcvCents: orderTcv },
    discrepancyCount,
    note: "",
  };
  result.note = buildNote(result);
  return result;
}

export function buildNote(r: ReconcileResult): string {
  const title = `Order form ${r.order.document_number ?? "(no number)"} vs. quote ${r.quote.document_number ?? "(no number)"}`;
  const customer = r.order.customer_name ?? r.quote.customer_name;
  const head = customer ? `${title} (${customer})` : title;

  const items: string[] = [];
  if (!r.quote.readable) items.push("The quote could not be read reliably. Please check it by hand.");
  if (!r.order.readable) items.push("The order form could not be read reliably. Please check it by hand.");
  for (const f of r.fields) {
    if (f.status === "mismatch" && f.key.startsWith("tcv_check_")) items.push(`${f.label}: ${f.quote || f.order}.`);
    else if (f.status === "mismatch") items.push(`${f.label}: quote ${f.quote}, order form ${f.order}.`);
    if (f.status === "missing") items.push(`${f.label}: ${f.quote === "not found" ? "not found in the quote" : "not found on the order form"}.`);
  }
  for (const l of r.lines) {
    if (l.status !== "match") items.push(`Line ${l.sku} (${l.description}): ${l.differences.join("; ")}.`);
  }

  // Header fields only; the "total vs. its own line items" checks are listed above, not counted here.
  const headerFields = r.fields.filter((f) => !f.key.startsWith("tcv_check_"));
  const okFields = headerFields.filter((f) => f.status === "match").length;
  const okLines = r.lines.filter((l) => l.status === "match").length;
  const footer =
    "Fields were extracted by an AI tool and compared in code. Please verify each flagged item against the source PDFs before countersigning.";

  if (items.length === 0) {
    return [
      head,
      `Result: no discrepancies. All ${okFields} header fields and ${okLines} line items match the quote.`,
      "",
      footer,
    ].join("\n");
  }
  return [
    head,
    `Result: ${items.length} ${items.length === 1 ? "discrepancy" : "discrepancies"}. Please correct the order form or confirm the change with the account executive.`,
    "",
    ...items.map((t, i) => `${i + 1}. ${t}`),
    "",
    `Matching: ${okFields} of ${headerFields.length} header fields, ${okLines} of ${r.lines.length} line items.`,
    footer,
  ].join("\n");
}
