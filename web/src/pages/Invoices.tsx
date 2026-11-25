/**
 * Invoices at a glance: the filed total, how many added up when recomputed, the suppliers by picture and share,
 * then every receipt as one row. A click on a row opens the mail with the read-out invoice.
 */
import { Building2, Check, ChevronRight, ReceiptText, ScanSearch, X } from "lucide-react";
import { motion } from "motion/react";
import type { InvoiceRow } from "../../../src/shared/types";
import { Ring, SplitBar } from "../components/charts/charts";
import { Avatar, AvatarStack, EmptyState, ErrorNote, Link } from "../components/common";
import { StatusBadge } from "../components/mail/parts";
import { CountUp } from "../components/motion";
import { PageScroll, usePageTitle } from "../components/shell/AppShell";
import { Card } from "../components/ui/card";
import { Skeleton } from "../components/ui/misc";
import { ROUTES, t } from "../i18n";
import { formatCents, formatDate, navigate, useApi } from "../lib";
import { cn } from "../utils";

const ease = [0.23, 1, 0.32, 1] as const;

function Checked({ ok }: { ok: boolean }) {
  return ok ? (
    <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-good">
      <Check className="size-4" aria-hidden /> {t("stimmt", "matches")}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-bad">
      <X className="size-4" aria-hidden /> {t("weicht ab", "differs")}
    </span>
  );
}

function Title({ icon: Icon, title, tone = "default" }: { icon: typeof ReceiptText; title: string; tone?: "default" | "hero" }) {
  return (
    <div className="flex items-center gap-3">
      <span aria-hidden className={cn("grid size-10 place-items-center rounded-full", tone === "hero" ? "bg-hero-2 text-hero-ink" : "bg-accent-soft text-accent-text")}>
        <Icon className="size-[18px]" strokeWidth={1.9} />
      </span>
      <h2 className={cn("text-[16px] font-medium tracking-[-0.01em]", tone === "hero" ? "text-hero-ink" : "text-ink")}>{title}</h2>
    </div>
  );
}

function Summary({ rows }: { rows: InvoiceRow[] }) {
  const filed = rows.filter((r) => r.status === "filed");
  const flagged = rows.filter((r) => !r.ok).length;
  const gross = filed.reduce((s, r) => s + r.grossCents, 0);
  const bySupplier = new Map<string, { cents: number; count: number }>();
  for (const r of filed) {
    const cur = bySupplier.get(r.supplier) ?? { cents: 0, count: 0 };
    bySupplier.set(r.supplier, { cents: cur.cents + r.grossCents, count: cur.count + 1 });
  }
  const suppliers = [...bySupplier.entries()].sort((a, b) => b[1].cents - a[1].cents);
  return (
    <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-12">
      <motion.section
        aria-label={t("Abgelegt", "Filed")}
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease }}
        data-mode="dark"
        className="flex flex-col rounded-[28px] bg-hero p-7 text-hero-ink shadow-card lg:col-span-5"
      >
        <Title icon={ReceiptText} title={t("Abgelegt", "Filed")} tone="hero" />
        <p className="mt-8 text-[56px] leading-none font-medium tracking-[-0.04em]">
          <CountUp id="invoices.gross" value={gross} format={(v) => formatCents(Math.round(v))} />
        </p>
        <p className="mt-3 text-[13.5px] text-hero-ink-2">
          {t(`brutto, ${filed.length} ${filed.length === 1 ? "Beleg" : "Belege"}`, `gross, ${filed.length} ${filed.length === 1 ? "invoice" : "invoices"}`)}
        </p>
        <div className="mt-auto flex items-center gap-3 pt-8">
          <AvatarStack names={suppliers.map(([n]) => n)} max={6} ring="ring-hero" />
          <span className="text-[13px] text-hero-ink-2">{t(`${suppliers.length} Lieferanten`, `${suppliers.length} ${suppliers.length === 1 ? "supplier" : "suppliers"}`)}</span>
        </div>
      </motion.section>

      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.05, ease }} className="lg:col-span-3">
        <Card className="flex h-full flex-col p-6">
          <Title icon={ScanSearch} title={t("Nachgerechnet", "Recalculated")} />
          <p className="mt-8 text-[44px] leading-none font-medium tracking-[-0.03em] text-ink">
            <CountUp id="invoices.matching" value={rows.length - flagged} />
            <span className="text-[22px] text-ink-3"> / {rows.length}</span>
          </p>
          <p className="mt-2 text-[13px] text-ink-2">{t("stimmen auf den Cent", "match to the cent")}</p>
          <div className="mt-auto pt-6">
            <SplitBar
              ariaLabel={t(`${rows.length - flagged} stimmen, ${flagged} mit Abweichung`, `${rows.length - flagged} match, ${flagged} differ`)}
              slices={[
                { key: "ok", label: t("Stimmen", "Match"), value: rows.length - flagged, color: "var(--accent)" },
                { key: "bad", label: t("Abweichung", "Differ"), value: flagged, color: "var(--chart-4)" },
              ]}
            />
          </div>
        </Card>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.1, ease }} className="lg:col-span-4">
        <Card className="flex h-full flex-col p-6">
          <Title icon={Building2} title={t("Lieferanten", "Suppliers")} />
          <ul className="mt-4 flex flex-col gap-1" aria-label={t("Lieferanten nach Betrag", "Suppliers by amount")}>
            {suppliers.slice(0, 4).map(([name, v], i) => (
              <motion.li key={name} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.3, delay: 0.15 + i * 0.05, ease }} className="-mx-2 flex items-center gap-3 rounded-[18px] px-2 py-2 hover:bg-surface-2">
                <Avatar name={name} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-medium text-ink">{name.replace(t(/\s+(GmbH(\s*&\s*Co\.\s*KG)?|KG|AG)$/, /\s+(Ltd\.?|Limited|Plc)$/i), "")}</span>
                  <span className="tnum block text-[12.5px] text-ink-3">{formatCents(v.cents)}</span>
                </span>
                <Ring value={gross === 0 ? 0 : v.cents / gross} size={42} label={t(`${Math.round(gross === 0 ? 0 : (v.cents / gross) * 100)} Prozent der Summe`, `${Math.round(gross === 0 ? 0 : (v.cents / gross) * 100)} percent of the total`)} />
              </motion.li>
            ))}
          </ul>
        </Card>
      </motion.div>
    </div>
  );
}

export function InvoicesPage() {
  usePageTitle(t("Rechnungen", "Invoices"));
  const { data, error, loading, reload } = useApi<InvoiceRow[]>("/api/invoices");
  const filed = (data ?? []).filter((r) => r.status === "filed");
  const sum = filed.reduce((s, r) => s + r.grossCents, 0);

  return (
    <PageScroll>
      <div className="pb-6">
        <h1 className="text-[32px] leading-tight font-medium tracking-[-0.03em] text-ink">{t("Rechnungen", "Invoices")}</h1>
        <p className="mt-1 text-[14px] text-ink-2">{data ? t(`${data.length} Belege ausgelesen`, `${data.length} invoices read`) : " "}</p>
      </div>
      {error && <ErrorNote message={error} onRetry={reload} />}
      {loading && !data && (
        <div aria-busy="true" aria-label={t("Wird geladen", "Loading")} className="flex flex-col gap-4">
          <Skeleton className="h-[300px] rounded-[28px]" />
          <Skeleton className="h-[420px] rounded-[28px]" />
        </div>
      )}
      {data && data.length === 0 && (
        <Card>
          <EmptyState icon={ReceiptText} title={t("Noch keine Rechnungen.", "No invoices yet.")} />
        </Card>
      )}
      {data && data.length > 0 && (
        <>
          <Summary rows={data} />
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.15, ease }}>
            <Card className="p-3 sm:p-4">
              <h2 className="px-3 pt-2 pb-2 text-[16px] font-medium text-ink">{t("Belege", "Documents")}</h2>
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full border-separate border-spacing-y-1 text-[13.5px]">
                  <thead>
                    <tr className="text-left text-[12.5px] text-ink-3">
                      <th className="px-3 py-2 font-normal">{t("Lieferant", "Supplier")}</th>
                      <th className="px-3 py-2 font-normal">{t("Nummer", "Number")}</th>
                      <th className="px-3 py-2 font-normal">{t("Datum", "Date")}</th>
                      <th className="px-3 py-2 text-right font-normal">{t("Brutto", "Gross")}</th>
                      <th className="px-3 py-2 font-normal">{t("Prüfung", "Check")}</th>
                      <th className="px-3 py-2 text-right font-normal">
                        <span className="sr-only">{t("Öffnen", "Open")}</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.map((r, i) => (
                      <motion.tr
                        key={r.mailId}
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.24, delay: 0.2 + i * 0.03 }}
                        onClick={() => navigate(`${ROUTES.mail}/${r.mailId}`)}
                        className={cn(
                          "group cursor-pointer [&>td]:transition-colors [&>td]:duration-150 [&>td:first-child]:rounded-l-[18px] [&>td:last-child]:rounded-r-[18px]",
                          r.ok ? "hover:[&>td]:bg-surface-2" : "[&>td]:bg-bad-soft",
                        )}
                      >
                        <td className="px-3 py-2">
                          <Link to={`${ROUTES.mail}/${r.mailId}`} className="flex items-center gap-3 font-medium text-ink">
                            <Avatar name={r.supplier} size="sm" />
                            <span className="truncate">{r.supplier}</span>
                          </Link>
                        </td>
                        <td className="tnum px-3 py-2 text-ink-2">{r.invoiceNumber}</td>
                        <td className="tnum px-3 py-2 text-ink-2">{r.invoiceDate ? formatDate(r.invoiceDate) : ""}</td>
                        <td className="tnum px-3 py-2 text-right font-medium text-ink">{formatCents(r.grossCents)}</td>
                        <td className="px-3 py-2">
                          <Checked ok={r.ok} />
                        </td>
                        <td className="px-3 py-2 text-right">
                          <span className="inline-flex items-center gap-2">
                            {r.status !== "filed" && <StatusBadge status={r.status} short />}
                            <ChevronRight className="size-4 text-ink-3 transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden />
                          </span>
                        </td>
                      </motion.tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="[&>td]:bg-surface-2 [&>td:first-child]:rounded-l-[18px] [&>td:last-child]:rounded-r-[18px]">
                      <td className="px-4 py-3.5 text-ink-2" colSpan={3}>
                        {t("Summe abgelegt", "Total filed")}
                      </td>
                      <td className="tnum px-3 py-3.5 text-right font-semibold text-ink">{formatCents(sum)}</td>
                      <td colSpan={2} />
                    </tr>
                  </tfoot>
                </table>
              </div>

              <ul className="flex flex-col gap-1.5 md:hidden">
                {data.map((r) => (
                  <li key={r.mailId}>
                    <Link to={`${ROUTES.mail}/${r.mailId}`} className={cn("press flex items-center gap-3 rounded-[20px] px-3 py-3", r.ok ? "bg-surface-2" : "bg-bad-soft")}>
                      <Avatar name={r.supplier} size="sm" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14px] font-medium text-ink">{r.supplier}</span>
                        <span className="tnum block text-[12.5px] text-ink-3">{r.invoiceNumber}</span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="tnum block text-[14px] text-ink">{formatCents(r.grossCents)}</span>
                        <Checked ok={r.ok} />
                      </span>
                    </Link>
                  </li>
                ))}
                <li className="flex items-baseline justify-between px-2 pt-2 text-[13.5px]">
                  <span className="text-ink-2">{t("Summe abgelegt", "Total filed")}</span>
                  <span className="tnum font-semibold text-ink">{formatCents(sum)}</span>
                </li>
              </ul>
            </Card>
          </motion.div>
        </>
      )}
    </PageScroll>
  );
}
