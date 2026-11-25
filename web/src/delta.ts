/**
 * How a key figure changed against the period before. Percentages on a small base look dramatic and say
 * little ("+114 %" for 7 to 15 mails), so they are only shown when the base is large; otherwise the
 * absolute change is shown ("+8"). The same rule holds for every card.
 */

export type ChangeKind = "count" | "cents";

/** Below these bases the absolute change is shown instead of a percentage. */
export const PERCENT_MIN_BASE: Record<ChangeKind, number> = {
  count: 50,
  cents: 1_000_000, // 10.000 €
};

export interface Change {
  direction: "up" | "down" | "same";
  /** Text for the chip, e.g. "+8", "−3", "+764 €", "+12 %", "±0". */
  text: string;
  mode: "absolute" | "percent" | "new" | "none";
}

const MINUS = "−";
const euro = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });

export function describeChange(value: number, previous: number, kind: ChangeKind): Change {
  if (value === previous) return { direction: "same", text: "±0", mode: previous === 0 ? "none" : "absolute" };
  const direction = value > previous ? "up" : "down";
  const sign = direction === "up" ? "+" : MINUS;
  if (previous >= PERCENT_MIN_BASE[kind]) {
    const pct = Math.round((Math.abs(value - previous) / previous) * 100);
    if (pct > 0) return { direction, text: `${sign}${pct} %`, mode: "percent" };
  }
  const diff = Math.abs(value - previous);
  const amount = kind === "cents" ? euro.format(Math.round(diff / 100)) : diff.toLocaleString("de-DE");
  return { direction, text: `${sign}${amount}`, mode: previous === 0 ? "new" : "absolute" };
}
