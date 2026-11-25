import type { Locale } from "../shared/locale";
import type { Cents } from "../shared/types";

/**
 * Converts a decimal amount from a model answer into integer cents.
 * Returns null for values that are not finite numbers.
 */
export function toCents(value: number | null | undefined): Cents | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return Math.round(value * 100);
}

/** quantity x unit price, rounded to whole cents once at the end. */
export function lineCents(quantity: number, unitPrice: number): Cents {
  // Work in hundredths of a cent first so that unit prices with up to four
  // decimals (e.g. 2.4995 EUR per litre) do not pick up float noise.
  const unitMilli = Math.round(unitPrice * 10_000);
  return Math.round((quantity * unitMilli) / 100);
}

/** Tax on a net amount, commercial rounding (half away from zero). */
export function taxCents(net: Cents, ratePercent: number): Cents {
  const raw = (net * ratePercent) / 100;
  return Math.sign(raw) * Math.round(Math.abs(raw));
}

const eurDe = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
const eurIe = new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" });
const eurEn = new Intl.NumberFormat("en-US", { style: "currency", currency: "EUR" });
const usdEn = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export function formatEur(cents: Cents): string {
  return eurDe.format(cents / 100);
}

/** Euro amount the way the tenant writes it: "1.000,00 €" (German) or "€1,000.00" (English, Ireland). */
export function formatMoney(cents: Cents, locale: Locale): string {
  return (locale === "en" ? eurIe : eurDe).format(cents / 100);
}

export function formatMoneyEn(cents: Cents, currency: string | null): string {
  if (currency === "USD") return usdEn.format(cents / 100);
  if (currency === "EUR") return eurEn.format(cents / 100);
  const n = (cents / 100).toFixed(2);
  return currency ? `${n} ${currency}` : n;
}
