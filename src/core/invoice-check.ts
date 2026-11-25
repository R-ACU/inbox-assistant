/**
 * Invoice checks. The model only reads what is printed on the invoice; this
 * module recomputes every total in integer cents and decides whether the
 * invoice can be filed or has to go to the review list.
 */
import type { InvoiceExtraction } from "../shared/schemas";
import type { Finding, InvoiceComputed } from "../shared/types";
import { formatIban, isValidIban, normalizeIban } from "./iban";
import { formatEur, lineCents, taxCents, toCents } from "./money";

export interface KnownSupplier {
  name: string;
  aliases: string[];
  iban: string;
  /** Mail domains the supplier sends invoices from. Subdomains count as the same sender. */
  domains: string[];
}

export interface InvoiceCheckContext {
  /** YYYY-MM-DD, injected so tests are deterministic. */
  today: string;
  suppliers: KnownSupplier[];
  /** Invoices already on file, for duplicate detection. */
  existing: { supplier: string; invoiceNumber: string }[];
  /** Address the invoice came from. Checked against the supplier's known domains. */
  senderAddress?: string;
}

export interface InvoiceCheck {
  ok: boolean;
  findings: Finding[];
  computed: InvoiceComputed | null;
  supplier: KnownSupplier | null;
}

const ALLOWED_TAX_RATES = [0, 7, 19];
/** Rounding per line can move the tax by a cent; more is an error. */
const TAX_TOLERANCE_CENTS = 1;

export function normalizeCompany(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, " und ")
    .replace(/\b(gmbh|kg|co|ohg|ag|ug|e\.?k\.?|mbh|haftungsbeschränkt)\b/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function findSupplier(name: string | null, suppliers: KnownSupplier[]): KnownSupplier | null {
  if (!name) return null;
  const n = normalizeCompany(name);
  return (
    suppliers.find((s) => [s.name, ...s.aliases].some((alias) => normalizeCompany(alias) === n)) ?? null
  );
}

/** Edit distance, used to catch look-alike supplier names ("Nordlichtt" for "Nordlicht"). */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length]!;
}

/** A known supplier whose name is close to, but not the same as, the given one. */
export function findLookalike(name: string, suppliers: KnownSupplier[]): KnownSupplier | null {
  const n = normalizeCompany(name);
  if (n.length < 5) return null;
  return (
    suppliers.find((s) =>
      [s.name, ...s.aliases].some((alias) => {
        const a = normalizeCompany(alias);
        return a !== n && levenshtein(a, n) <= 2;
      }),
    ) ?? null
  );
}

function domainMatches(address: string, domains: string[]): boolean {
  const domain = address.split("@")[1]?.toLowerCase() ?? "";
  return domains.some((d) => domain === d || domain.endsWith(`.${d}`));
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

export function checkInvoice(ex: InvoiceExtraction, ctx: InvoiceCheckContext): InvoiceCheck {
  const findings: Finding[] = [];
  const add = (code: string, severity: Finding["severity"], message: string) =>
    findings.push({ code, severity, message });

  if (!ex.readable) {
    add(
      "unreadable",
      "error",
      `Beleg nicht sicher lesbar${ex.unreadable_reason ? `: ${ex.unreadable_reason}` : "."} Bitte von Hand prüfen.`,
    );
    return { ok: false, findings, computed: null, supplier: null };
  }

  const required: [keyof InvoiceExtraction, string][] = [
    ["supplier_name", "Lieferant"],
    ["invoice_number", "Rechnungsnummer"],
    ["invoice_date", "Rechnungsdatum"],
    ["net_total", "Nettobetrag"],
    ["tax_rate_percent", "Steuersatz"],
    ["tax_total", "Steuerbetrag"],
    ["gross_total", "Bruttobetrag"],
  ];
  for (const [key, label] of required) {
    if (ex[key] === null) add("missing_field", "error", `Pflichtangabe fehlt: ${label}.`);
  }
  if (ex.line_items.length === 0) add("no_line_items", "error", "Keine Positionen erkannt.");
  if (ex.currency !== null && ex.currency !== "EUR") {
    add("currency", "error", `Währung ${ex.currency} wird nicht automatisch verbucht.`);
  }

  // --- Arithmetic, all in cents ---------------------------------------------
  let computed: InvoiceComputed | null = null;
  const net = toCents(ex.net_total);
  const tax = toCents(ex.tax_total);
  const gross = toCents(ex.gross_total);

  ex.line_items.forEach((line, i) => {
    const expected = lineCents(line.quantity, line.unit_price);
    const printed = toCents(line.line_total);
    if (printed !== null && Math.abs(expected - printed) > 1) {
      add(
        "line_total_mismatch",
        "error",
        `Position ${i + 1} (${line.description}): ${line.quantity} × Einzelpreis ergibt ${formatEur(expected)}, auf der Rechnung steht ${formatEur(printed)}.`,
      );
    }
  });

  if (net !== null && ex.line_items.length > 0) {
    const lineSum = ex.line_items.reduce((sum, l) => sum + (toCents(l.line_total) ?? 0), 0);
    const rate = ex.tax_rate_percent ?? 0;
    const expectedTax = taxCents(lineSum, rate);
    computed = { lineSum, expectedTax, expectedGross: lineSum + expectedTax };

    if (lineSum !== net) {
      add(
        "net_sum_mismatch",
        "error",
        `Summe der Positionen ${formatEur(lineSum)} weicht vom ausgewiesenen Netto ${formatEur(net)} ab (Differenz ${formatEur(net - lineSum)}).`,
      );
    }
    if (ex.tax_rate_percent !== null && !ALLOWED_TAX_RATES.includes(ex.tax_rate_percent)) {
      add("unusual_tax_rate", "error", `Ungewöhnlicher Steuersatz: ${ex.tax_rate_percent} %.`);
    }
    if (tax !== null && ex.tax_rate_percent !== null) {
      const taxOnPrinted = taxCents(net, ex.tax_rate_percent);
      if (Math.abs(taxOnPrinted - tax) > TAX_TOLERANCE_CENTS) {
        add(
          "tax_mismatch",
          "error",
          `${ex.tax_rate_percent} % auf ${formatEur(net)} ergeben ${formatEur(taxOnPrinted)}, ausgewiesen sind ${formatEur(tax)}.`,
        );
      }
    }
    if (tax !== null && gross !== null && net + tax !== gross) {
      add(
        "gross_mismatch",
        "error",
        `Netto plus Steuer ergibt ${formatEur(net + tax)}, ausgewiesen sind ${formatEur(gross)} brutto.`,
      );
    }
    if (gross !== null && gross <= 0) add("non_positive", "warning", "Bruttobetrag ist null oder negativ (Gutschrift?).");
  }

  // --- Plausibility ----------------------------------------------------------
  if (ex.invoice_date) {
    const age = daysBetween(ex.invoice_date, ctx.today);
    if (age < 0) add("date_in_future", "error", "Rechnungsdatum liegt in der Zukunft.");
    else if (age > 365) add("date_too_old", "warning", "Rechnungsdatum ist älter als ein Jahr.");
  }

  // A supplier that is not in the master data cannot be checked against a known IBAN or
  // sender domain, so it is never filed automatically (classic "new bank details" fraud).
  const supplier = findSupplier(ex.supplier_name, ctx.suppliers);
  if (ex.supplier_name && !supplier) {
    const lookalike = findLookalike(ex.supplier_name, ctx.suppliers);
    if (lookalike) {
      add(
        "supplier_lookalike",
        "error",
        `Lieferantenname ähnelt „${lookalike.name}“, ist aber nicht gleich. Möglicher Doppelgänger, vor jeder Zahlung beim bekannten Lieferanten nachfragen.`,
      );
    } else {
      add("unknown_supplier", "error", "Lieferant ist nicht in den Stammdaten. Bankverbindung und Absender vor der Ablage prüfen.");
    }
  }
  if (supplier && ctx.senderAddress && supplier.domains.length > 0 && !domainMatches(ctx.senderAddress, supplier.domains)) {
    add(
      "sender_domain_mismatch",
      "error",
      `Absender ${ctx.senderAddress} gehört nicht zu den bekannten Domains von ${supplier.name} (${supplier.domains.join(", ")}).`,
    );
  }
  if (ex.iban) {
    if (!isValidIban(ex.iban)) {
      add("invalid_iban", "error", `IBAN ${formatIban(ex.iban)} ist ungültig (Prüfziffer).`);
    } else if (supplier && normalizeIban(supplier.iban) !== normalizeIban(ex.iban)) {
      add(
        "iban_changed",
        "error",
        `IBAN weicht von den Stammdaten ab (bekannt: ${formatIban(supplier.iban)}). Vor jeder Zahlung telefonisch bestätigen.`,
      );
    }
  }

  if (ex.supplier_name && ex.invoice_number) {
    const key = normalizeCompany(supplier?.name ?? ex.supplier_name);
    const dup = ctx.existing.some(
      (e) => normalizeCompany(e.supplier) === key && e.invoiceNumber.trim() === ex.invoice_number!.trim(),
    );
    if (dup) add("duplicate_invoice", "error", "Diese Rechnungsnummer ist für den Lieferanten schon erfasst.");
  }

  const ok = !findings.some((f) => f.severity === "error");
  return { ok, findings, computed, supplier };
}
