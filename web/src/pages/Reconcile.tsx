import { Check, Copy, FileText, FileUp, GitCompareArrows, Languages, ListChecks, Minus, NotebookPen, Sigma, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ReconcileField, ReconcileLine, ReconcileResult } from "../../../src/shared/types";
import { SplitBar } from "../components/charts/charts";
import { ErrorNote } from "../components/common";
import { CountUp } from "../components/motion";
import { PageScroll, usePageTitle } from "../components/shell/AppShell";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardHeader, InnerCard } from "../components/ui/card";
import { Skeleton } from "../components/ui/misc";
import { Select } from "../components/ui/select";
import { Tooltip } from "../components/ui/tooltip";
import { useToast } from "../components/ui/toast";
import { t } from "../i18n";
import { api, useApi } from "../lib";
import { cn } from "../utils";

interface Sample {
  id: string;
  title: string;
  quote: string;
  order: string;
}

const ease = [0.23, 1, 0.32, 1] as const;

// Field names in the language of the UI; the values stay as printed on the English documents.
const FIELD_LABEL: Record<string, string> = t<Record<string, string>>(
  {
    customer: "Kunde",
    quote_reference: "Angebotsnummer",
    currency: "Währung",
    start_date: "Vertragsbeginn",
    term: "Laufzeit (Monate)",
    billing: "Abrechnung",
    payment_terms: "Zahlungsziel",
    auto_renewal: "Automatische Verlängerung",
    tcv: "Vertragswert gesamt",
    tcv_check_quote: "Angebot: Summe gegen Positionen",
    tcv_check_order: "Bestellung: Summe gegen Positionen",
  },
  {
    customer: "Customer",
    quote_reference: "Quote number",
    currency: "Currency",
    start_date: "Start date",
    term: "Term (months)",
    billing: "Billing",
    payment_terms: "Payment terms",
    auto_renewal: "Auto-renewal",
    tcv: "Total contract value",
    tcv_check_quote: "Quote: total vs lines",
    tcv_check_order: "Order: total vs lines",
  },
);

function StatusCell({ status }: { status: ReconcileField["status"] | ReconcileLine["status"] }) {
  if (status === "match") {
    return (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-good">
        <Check className="size-4" aria-hidden /> {t("gleich", "same")}
      </span>
    );
  }
  if (status === "missing") {
    return (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-accent-text">
        <Minus className="size-4" aria-hidden /> {t("fehlt", "missing")}
      </span>
    );
  }
  const label = status === "only_in_quote" ? t("nur im Angebot", "quote only") : status === "only_in_order" ? t("nur in der Bestellung", "order only") : t("abweichend", "differs");
  return (
    <span className="inline-flex items-center gap-1.5 font-medium whitespace-nowrap text-bad">
      <X className="size-4" aria-hidden /> {label}
    </span>
  );
}

function FilePick({ label, file, onPick }: { label: string; file: File | null; onPick: (f: File | null) => void }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="min-w-0 flex-1">
      <input ref={input} type="file" accept="application/pdf,.pdf" className="sr-only" tabIndex={-1} onChange={(e) => onPick(e.target.files?.[0] ?? null)} />
      <button
        type="button"
        onClick={() => input.current?.click()}
        className="press flex h-11 w-full items-center gap-3 rounded-full border border-dashed border-line-strong bg-surface px-4 text-left text-[13.5px] hover:border-ink-3 hover:bg-surface-2"
      >
        <FileUp className="size-4 shrink-0 text-ink-3" aria-hidden />
        <span className="min-w-0 flex-1 truncate">
          <span className="text-ink-2">{label}: </span>
          <span className={file ? "text-ink" : "text-ink-3"}>{file ? file.name : t("PDF wählen", "Choose PDF")}</span>
        </span>
      </button>
    </div>
  );
}

const lineText = (side: ReconcileLine["quote"]) =>
  side ? t(`${side.quantity} × ${side.unitPrice}, Rabatt ${side.discount}`, `${side.quantity} × ${side.unitPrice}, discount ${side.discount}`) : t("nicht enthalten", "not included");

/** Quantity, price and discount on three lines, differing values in the error colour. */
function LineSide({ side, other }: { side: ReconcileLine["quote"]; other: ReconcileLine["quote"] }) {
  if (!side) return <span className="text-ink-3">{t("nicht enthalten", "not included")}</span>;
  const diff = (a: string, b: string | undefined) => (other && a !== b ? "font-medium text-bad" : "text-ink");
  return (
    <span className="tnum flex flex-col gap-0.5 leading-snug">
      <span className={diff(String(side.quantity), other ? String(other.quantity) : undefined)}>{t(`${side.quantity} Stück`, `${side.quantity} units`)}</span>
      <span className={diff(side.unitPrice, other?.unitPrice)}>{t(`je ${side.unitPrice}`, `${side.unitPrice} each`)}</span>
      <span className={cn("text-[12.5px]", other && side.discount !== other.discount ? "font-medium text-bad" : "text-ink-2")}>{t(`Rabatt ${side.discount}`, `Discount ${side.discount}`)}</span>
    </span>
  );
}

/** One key figure. Matching and differing items as one continuous bar, never as separate dots. */
function Stat({ label, value, note, ok, total, dark = false, index }: { label: string; value: ReactNode; note?: string; ok?: number; total?: number; dark?: boolean; index: number }) {
  return (
    <motion.div
      role="group"
      aria-label={label}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: index * 0.05, ease }}
      data-mode={dark ? "dark" : undefined}
      className={cn("flex flex-col justify-between gap-6 rounded-[28px] p-6 shadow-card", dark ? "bg-hero text-hero-ink" : "bg-surface")}
    >
      <p className={cn("text-[14px] font-medium", dark ? "text-hero-ink-2" : "text-ink-2")}>{label}</p>
      <div>
        <p className={cn("tnum text-[44px] leading-none font-medium tracking-[-0.03em]", dark ? "text-hero-ink" : "text-ink")}>{value}</p>
        {total !== undefined && ok !== undefined && (
          <div className="mt-4">
            <SplitBar
              legend={false}
              height={10}
              ariaLabel={t(`${ok} gleich, ${total - ok} abweichend`, `${ok} same, ${total - ok} differ`)}
              slices={[
                { key: "ok", label: t("gleich", "same"), value: ok, color: "var(--accent)" },
                { key: "bad", label: t("abweichend", "differ"), value: total - ok, color: "var(--chart-4)" },
              ]}
            />
          </div>
        )}
        {note && <p className={cn("mt-3 text-[13px]", dark ? "text-hero-ink-2" : "text-ink-3")}>{note}</p>}
      </div>
    </motion.div>
  );
}

function rowTone(match: boolean) {
  return cn("[&>td]:py-3 [&>td:first-child]:rounded-l-[16px] [&>td:last-child]:rounded-r-[16px]", match ? "hover:[&>td]:bg-surface-2" : "[&>td]:bg-bad-soft");
}

function Result({ result }: { result: ReconcileResult }) {
  const toast = useToast();
  const copy = async () => {
    await navigator.clipboard.writeText(result.note).then(
      () => toast(t("Notiz kopiert", "Note copied")),
      () => toast(t("Kopieren nicht möglich, bitte markieren", "Cannot copy, please select the text"), "info"),
    );
  };
  const n = result.discrepancyCount;
  const headFields = result.fields.filter((f) => !f.key.startsWith("tcv_check"));
  const fieldsOk = headFields.filter((f) => f.status === "match").length;
  const linesOk = result.lines.filter((l) => l.status === "match").length;
  const currency = result.order.currency ?? result.quote.currency ?? "USD";
  const fmt = (cents: number | null) => (cents === null ? t("nicht lesbar", "not readable") : new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100));
  const stated = (v: number | null) => (v === null ? null : Math.round(v * 100));
  const totals = [
    { label: t("Angebot", "Quote"), stated: stated(result.quote.total_contract_value), computed: result.computed.quoteTcvCents },
    { label: t("Bestellformular", "Order form"), stated: stated(result.order.total_contract_value), computed: result.computed.orderTcvCents },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2 px-1 text-[13.5px] text-ink-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-surface px-3 py-1.5 shadow-card">
          <FileText className="size-4 text-ink-3" aria-hidden />
          {result.order.document_number ?? t("Bestellformular", "Order form")}
        </span>
        <GitCompareArrows className="size-4 text-ink-3" aria-hidden />
        <span className="inline-flex items-center gap-1.5 rounded-full bg-surface px-3 py-1.5 shadow-card">
          <FileText className="size-4 text-ink-3" aria-hidden />
          {result.quote.document_number ?? t("Angebot", "Quote")}
        </span>
        <span className="ml-1 truncate text-ink-3">{result.order.customer_name ?? result.quote.customer_name}</span>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <Stat index={0} dark label={t("Abweichungen", "Discrepancies")} value={<CountUp id="reconcile.discrepancies" value={n} />} note={n === 0 ? t("Alles gleich", "All the same") : t("Alle in der Notiz", "All in the note")} />
        <Stat index={1} label={t("Kopfdaten", "Header fields")} value={t(`${fieldsOk} von ${headFields.length}`, `${fieldsOk} of ${headFields.length}`)} ok={fieldsOk} total={headFields.length} />
        <Stat index={2} label={t("Positionen", "Line items")} value={t(`${linesOk} von ${result.lines.length}`, `${linesOk} of ${result.lines.length}`)} ok={linesOk} total={result.lines.length} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card className="p-6">
            <CardHeader icon={ListChecks} title={t("Kopfdaten", "Header fields")} />
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[520px] border-separate border-spacing-y-1 text-[13.5px]">
                <thead>
                  <tr className="text-left text-[12.5px] text-ink-3">
                    <th className="px-3 pb-1 font-normal">{t("Feld", "Field")}</th>
                    <th className="px-3 pb-1 font-normal">{t("Angebot", "Quote")}</th>
                    <th className="px-3 pb-1 font-normal">{t("Bestellformular", "Order form")}</th>
                    <th className="px-3 pb-1 text-right font-normal">{t("Ergebnis", "Result")}</th>
                  </tr>
                </thead>
                <tbody>
                  {headFields.map((f) => (
                    <tr key={f.key} className={rowTone(f.status === "match")}>
                      <td className="px-3 text-ink-2">{FIELD_LABEL[f.key] ?? f.label}</td>
                      <td className="tnum px-3 text-ink">{f.quote}</td>
                      <td className="tnum px-3 text-ink">{f.order}</td>
                      <td className="px-3 text-right text-[13px]">
                        <StatusCell status={f.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          <Card className="p-6">
            <CardHeader icon={Sigma} title={t("Summen", "Totals")} />
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {totals.map((row) => {
                const ok = row.stated === null || row.computed === null ? null : row.stated === row.computed;
                return (
                  <InnerCard key={row.label} className={cn("p-5", ok === false && "bg-bad-soft")}>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[14px] font-medium text-ink">{row.label}</span>
                      {ok === null ? <span className="text-[13px] text-ink-3">{t("offen", "open")}</span> : <StatusCell status={ok ? "match" : "mismatch"} />}
                    </div>
                    <dl className="tnum mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[13px]">
                      <dt className="text-ink-3">{t("genannt", "stated")}</dt>
                      <dd className="text-right text-ink">{fmt(row.stated)}</dd>
                      <dt className="text-ink-3">{t("berechnet", "calculated")}</dt>
                      <dd className="text-right text-ink">{fmt(row.computed)}</dd>
                    </dl>
                  </InnerCard>
                );
              })}
            </div>
          </Card>
          <Card className="p-6">
            <CardHeader icon={ListChecks} title={t("Positionen", "Line items")} />
            <ul className="mt-4 flex flex-col gap-2 sm:hidden">
              {result.lines.map((l) => (
                <li key={l.sku} className={cn("rounded-[20px] px-4 py-3", l.status === "match" ? "bg-surface-2" : "bg-bad-soft")}>
                  <div className="flex items-start justify-between gap-3">
                    <span className="min-w-0">
                      <span className="block text-[13.5px] text-ink">{l.sku}</span>
                      <span className="block text-[12.5px] text-ink-3">{l.description}</span>
                    </span>
                    <span className="shrink-0 text-[12.5px]">
                      <StatusCell status={l.status} />
                    </span>
                  </div>
                  <dl className="tnum mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[13px]">
                    <dt className="text-ink-3">{t("Angebot", "Quote")}</dt>
                    <dd className="text-ink-2">{lineText(l.quote)}</dd>
                    <dt className="text-ink-3">{t("Bestellung", "Order")}</dt>
                    <dd className="text-ink-2">{lineText(l.order)}</dd>
                  </dl>
                </li>
              ))}
            </ul>
            <div className="mt-4 hidden overflow-x-auto sm:block">
              <table className="w-full min-w-[480px] border-separate border-spacing-y-1 text-[13.5px]">
                <thead>
                  <tr className="text-left text-[12.5px] text-ink-3">
                    <th className="px-3 pb-1 font-normal">{t("Artikel", "Item")}</th>
                    <th className="px-3 pb-1 font-normal">{t("Angebot", "Quote")}</th>
                    <th className="px-3 pb-1 font-normal">{t("Bestellformular", "Order form")}</th>
                    <th className="px-3 pb-1 text-right font-normal">{t("Ergebnis", "Result")}</th>
                  </tr>
                </thead>
                <tbody>
                  {result.lines.map((l) => (
                    <tr key={l.sku} className={cn(rowTone(l.status === "match"), "align-top")}>
                      <td className="px-3">
                        <span className="block text-ink">{l.sku}</span>
                        <span className="block text-[12.5px] text-ink-3">{l.description}</span>
                      </td>
                      <td className="px-3">
                        <LineSide side={l.quote} other={l.order} />
                      </td>
                      <td className="px-3">
                        <LineSide side={l.order} other={l.quote} />
                      </td>
                      <td className="px-3 text-right text-[13px]">
                        <StatusCell status={l.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>

        <Card className="self-start p-6 xl:sticky xl:top-0">
          <CardHeader
            icon={NotebookPen}
            title={t("Notiz für das Team", "Note for the team")}
            description={t("Englisch", "English")}
            aside={
              <Button variant="secondary" size="sm" icon={<Copy aria-hidden />} onClick={copy}>
                {t("Kopieren", "Copy")}
              </Button>
            }
          />
          <InnerCard className="mt-5 p-5">
            <pre className="font-sans text-[13.5px] leading-[1.7] break-words whitespace-pre-wrap text-ink" lang="en">
              {result.note}
            </pre>
          </InnerCard>
        </Card>
      </div>
    </div>
  );
}

export function ReconcilePage() {
  usePageTitle(t("Abgleich", "Reconciliation"));
  const samples = useApi<Sample[]>("/api/reconcile/samples");
  const [sample, setSample] = useState<string>("northgate");
  const [quote, setQuote] = useState<File | null>(null);
  const [order, setOrder] = useState<File | null>(null);
  const [result, setResult] = useState<ReconcileResult | null>(null);
  const [busy, setBusy] = useState<"sample" | "upload" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runSample = async (id: string) => {
    setBusy("sample");
    setError(null);
    try {
      setResult(await api<ReconcileResult>(`/api/reconcile/samples/${id}`, { method: "POST" }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const runUpload = async () => {
    if (!quote || !order) return;
    setBusy("upload");
    setError(null);
    const form = new FormData();
    form.append("quote", quote);
    form.append("order", order);
    try {
      setResult(await api<ReconcileResult>("/api/reconcile", { method: "POST", form }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  useEffect(() => {
    if (samples.data?.some((s) => s.id === sample)) void runSample(sample);
    // Run the default sample once when the list has loaded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [samples.data]);

  return (
    <PageScroll>
      <div className="flex flex-col gap-4 pb-6 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-[32px] leading-tight font-medium tracking-[-0.03em] text-ink">{t("Abgleich", "Reconciliation")}</h1>
          <p className="mt-1 text-[14px] text-ink-2">{t("Bestellformular gegen Angebot", "Order form against quote")}</p>
        </div>
        <Tooltip content={t("Modell liest nur, verglichen wird im Code", "The model only reads; code compares")} side="left">
          <Badge tone="neutral" size="md" className="h-11 shrink-0 bg-surface px-4 text-[13px] shadow-card" tabIndex={0}>
            <Languages aria-hidden />
            {t("Englische Dokumente", "English documents")}
          </Badge>
        </Tooltip>
      </div>

      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <p className="mb-3 px-1 text-[13.5px] font-medium text-ink-2">{t("Beispiel", "Sample")}</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Select
              label={t("Beispielpaar", "Sample pair")}
              value={sample}
              onChange={setSample}
              className="flex-1"
              options={(samples.data ?? []).map((s) => ({ value: s.id, label: s.title, hint: t(`${s.quote} und ${s.order}`, `${s.quote} and ${s.order}`) }))}
            />
            <Button variant="primary" icon={<GitCompareArrows aria-hidden />} busy={busy === "sample"} disabled={busy !== null || !samples.data} onClick={() => runSample(sample)}>
              {t("Abgleichen", "Reconcile")}
            </Button>
          </div>
        </Card>
        <Card className="p-5">
          <p className="mb-3 px-1 text-[13.5px] font-medium text-ink-2">
            {t("Eigene PDFs", "Your own PDFs")} <span className="font-normal text-ink-3">{t("bis 5 MB", "up to 5 MB")}</span>
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <FilePick label={t("Angebot", "Quote")} file={quote} onPick={setQuote} />
            <FilePick label={t("Bestellung", "Order")} file={order} onPick={setOrder} />
            <Button variant="secondary" busy={busy === "upload"} disabled={!quote || !order || busy !== null} onClick={runUpload}>
              {t("Prüfen", "Check")}
            </Button>
          </div>
        </Card>
      </div>

      {error && (
        <div className="mb-4">
          <ErrorNote message={error} />
        </div>
      )}
      {busy && !result && (
        <div aria-busy="true" aria-label={t("Wird geladen", "Loading")} className="grid gap-4 md:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-[180px] rounded-[28px]" />
          ))}
        </div>
      )}
      <AnimatePresence mode="wait">
        {result && (
          <motion.div key={`${result.order.document_number}-${result.discrepancyCount}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
            <Result result={result} />
          </motion.div>
        )}
      </AnimatePresence>
    </PageScroll>
  );
}
