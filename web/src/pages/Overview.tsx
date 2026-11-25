/**
 * Overview, readable at a glance like a banking app: what came in (dark hero with one pill column per day),
 * what waits for the owner (the strong card with the faces of the customers), how much the assistant did on
 * its own (half ring), invoice money (pill bars) and the latest mails as a feed. Short labels, big numbers,
 * details on hover.
 */
import { ArrowDownRight, ArrowRight, ArrowUpRight, CircleAlert, FolderCheck, Gauge as GaugeIcon, History, Inbox, ListTodo, PenLine, ReceiptText, ShieldAlert, type LucideIcon } from "lucide-react";
import { motion } from "motion/react";
import { useState, type ReactNode } from "react";
import { CATEGORIES } from "../categories";
import type { DashboardData, DashboardOutcome, MailListItem } from "../../../src/shared/types";
import { HalfGauge, SparkBars, StackedPills, ValueLegend } from "../components/charts/charts";
import { AvatarStack, CATEGORY_COLOR, CornerLink, ErrorNote, Link, MailAvatar } from "../components/common";
import { CountUp } from "../components/motion";
import { PageScroll, usePageTitle } from "../components/shell/AppShell";
import { Card, IconCircle, InnerCard } from "../components/ui/card";
import { Skeleton } from "../components/ui/misc";
import { Segmented } from "../components/ui/segmented";
import { describeChange, type ChangeKind } from "../delta";
import { CATEGORY_LABEL, formatCents, formatDay, formatDayLong, formatListTime, useApi } from "../lib";
import { cn } from "../utils";

const euro0 = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const euroOf = (cents: number) => euro0.format(Math.round(cents / 100));
const ease = [0.23, 1, 0.32, 1] as const;

function greeting() {
  // formatToParts: the German format is "02 Uhr", which Number() cannot read.
  const part = new Intl.DateTimeFormat("de-DE", { hour: "numeric", hourCycle: "h23", timeZone: "Europe/Berlin" }).formatToParts(new Date()).find((p) => p.type === "hour");
  const h = Number(part?.value ?? 12);
  return h < 11 ? "Guten Morgen" : h < 18 ? "Guten Tag" : "Guten Abend";
}

/** Bento cells enter one after another, a few frames apart. */
function Cell({ index, className, children }: { index: number; className?: string; children: ReactNode }) {
  return (
    <motion.div className={cn("min-w-0", className)} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: index * 0.05, ease }}>
      {children}
    </motion.div>
  );
}

/** Up is green, down is a quiet grey: red stays reserved for errors. Small bases show the absolute change. */
function DeltaChip({ value, previous, kind, onStrong = false }: { value: number; previous: number; kind: ChangeKind; onStrong?: boolean }) {
  const change = describeChange(value, previous, kind);
  const Icon = change.direction === "up" ? ArrowUpRight : change.direction === "down" ? ArrowDownRight : ArrowRight;
  return (
    <span
      className={cn(
        "tnum inline-flex h-7 items-center gap-0.5 rounded-full pr-2.5 pl-2 text-[12.5px] font-semibold whitespace-nowrap",
        onStrong ? "bg-black/20 text-white" : change.direction === "up" ? "bg-good-soft text-good" : "bg-surface-2 text-ink-2",
      )}
    >
      <Icon className="size-3.5" strokeWidth={2.25} aria-hidden />
      {change.text}
    </span>
  );
}

function CardTitle({ icon, title, aside, tone = "default" }: { icon: LucideIcon; title: string; aside?: ReactNode; tone?: "default" | "hero" | "strong" }) {
  const Icon = icon;
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        <span
          aria-hidden
          className={cn(
            "grid size-10 shrink-0 place-items-center rounded-full",
            tone === "hero" ? "bg-hero-2 text-hero-ink" : tone === "strong" ? "bg-white/15 text-white" : "bg-accent-soft text-accent-text",
          )}
        >
          <Icon className="size-[18px]" strokeWidth={1.9} />
        </span>
        <h2 className={cn("truncate text-[16px] font-medium tracking-[-0.01em]", tone === "hero" ? "text-hero-ink" : tone === "strong" ? "text-white" : "text-ink")}>{title}</h2>
      </div>
      {aside}
    </div>
  );
}

// ---------------------------------------------------------------- hero: mails per day

function Hero({ data, days }: { data: DashboardData; days: "7" | "14" }) {
  const totals = Object.fromEntries(CATEGORIES.map((c) => [c, data.days.reduce((s, d) => s + d.byCategory[c], 0)])) as Record<(typeof CATEGORIES)[number], number>;
  const columns = data.days.map((d, i) => ({
    label: i === data.days.length - 1 ? "Heute" : days === "7" ? formatDay(d.date).split(",")[0]! : formatDay(d.date).split(",")[1]!.trim().replace(/\.\d\d\.$/, "."),
    tooltipTitle: formatDayLong(d.date),
    ...d.byCategory,
  }));
  return (
    <section aria-labelledby="by-kind" data-mode="dark" className="flex h-full flex-col rounded-[28px] bg-hero p-7 text-hero-ink shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="flex items-center gap-3">
          <span aria-hidden className="grid size-10 place-items-center rounded-full bg-hero-2">
            <Inbox className="size-[18px]" strokeWidth={1.9} />
          </span>
          <h2 id="by-kind" className="text-[16px] font-medium tracking-[-0.01em]">
            Eingang
          </h2>
        </div>
        <ValueLegend tone="hero" className="pt-2" items={CATEGORIES.map((c) => ({ key: c, label: CATEGORY_LABEL[c], value: String(totals[c]), color: CATEGORY_COLOR[c].fill }))} />
      </div>
      <div className="mt-4 grid flex-1 grid-cols-1 items-end gap-6 md:grid-cols-[170px_minmax(0,1fr)]">
        <div className="pb-9">
          <p className="text-[13px] text-hero-ink-2">Mails</p>
          <p className="mt-1 text-[60px] leading-none font-medium tracking-[-0.04em]">
            <CountUp id="overview.mails" value={data.current.mails} />
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <DeltaChip value={data.current.mails} previous={data.previous.mails} kind="count" />
          </div>
          <p className="mt-2 text-[12.5px] text-hero-ink-2">{days === "7" ? "zur Vorwoche" : "zu den 14 Tagen davor"}</p>
        </div>
        <StackedPills
          key={days}
          tone="hero"
          data={columns}
          series={CATEGORIES.map((c) => ({ key: c, label: CATEGORY_LABEL[c], color: CATEGORY_COLOR[c].fill }))}
          ariaLabel="Mails pro Tag nach Art"
          height={250}
        />
      </div>
      <table className="sr-only">
        <caption>Mails pro Tag nach Kategorie</caption>
        <thead>
          <tr>
            <th>Tag</th>
            {CATEGORIES.map((c) => (
              <th key={c}>{CATEGORY_LABEL[c]}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.days.map((d) => (
            <tr key={d.date}>
              <td>{formatDayLong(d.date)}</td>
              {CATEGORIES.map((c) => (
                <td key={c}>{d.byCategory[c]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

// ---------------------------------------------------------------- what waits

function Waiting({ data, mails }: { data: DashboardData; mails: MailListItem[] }) {
  const waiting = mails.filter((m) => m.status === "awaiting_approval").sort((a, b) => a.date.localeCompare(b.date));
  const review = mails.filter((m) => m.status === "needs_review" || m.status === "quarantined" || m.status === "delivery_failed").length;
  const total = data.tasks.length;
  const links = [
    { to: "/freigabe", label: "Freigabe", count: waiting.length, icon: PenLine },
    { to: "/pruefliste", label: "Prüfen", count: review, icon: CircleAlert },
  ];
  return (
    <section aria-labelledby="waiting" className="flex h-full flex-col rounded-[28px] bg-accent-strong p-7 text-white shadow-card">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span aria-hidden className="grid size-10 place-items-center rounded-full bg-white/15">
            <ListTodo className="size-[18px]" strokeWidth={1.9} />
          </span>
          <h2 id="waiting" className="text-[16px] font-medium tracking-[-0.01em]">
            Zu erledigen
          </h2>
        </div>
        <CornerLink to="/freigabe" label="Zum Posteingang" tone="strong" />
      </div>
      <div className="mt-6 flex items-end justify-between gap-4">
        <div>
          <p className="text-[76px] leading-none font-medium tracking-[-0.045em]">
            <CountUp id="overview.waiting" value={total} />
          </p>
          <p className="mt-2 text-[14px] text-white">{total === 1 ? "Mail wartet auf Sie" : "Mails warten auf Sie"}</p>
        </div>
      </div>
      <div className="mt-auto pt-6">
        {waiting.length > 0 && <AvatarStack names={waiting.map((m) => m.from.name || m.from.address)} max={5} size="lg" ring="ring-accent-strong" className="mb-5" />}
        <div className="grid grid-cols-2 gap-2">
          {links.map((l) => (
            <Link key={l.to} to={l.to} className="press group flex h-12 items-center gap-2.5 rounded-full bg-black/15 pr-3 pl-4 text-[13.5px] font-medium text-white hover:bg-black/25">
              <l.icon className="size-4 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1 truncate">{l.label}</span>
              <span className="tnum">{l.count}</span>
              <ArrowRight className="size-4 shrink-0 transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden />
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- automation rate

function Automation({ data }: { data: DashboardData }) {
  const auto = data.outcomes.auto + data.outcomes.prepared;
  const manual = data.outcomes.review + data.outcomes.quarantine;
  const total = auto + manual;
  const pct = (n: number) => `${Math.round(total === 0 ? 0 : (n / total) * 100)} %`;
  return (
    <Card className="flex h-full flex-col p-6">
      <CardTitle icon={GaugeIcon} title="Ohne Nacharbeit" />
      <InnerCard className="mt-5 flex flex-1 flex-col items-center justify-end px-4 pt-6 pb-4">
        <HalfGauge
          width={250}
          ariaLabel={`${pct(auto)} ohne Nacharbeit`}
          parts={[
            { key: "auto", label: "ohne Nacharbeit", value: auto },
            { key: "manual", label: "mit Ihrem Blick", value: manual },
          ]}
          center={(h) => (
            <>
              <p className="tnum text-[38px] leading-none font-medium tracking-[-0.03em] text-ink">{h ? pct(h.value) : <CountUp id="overview.automation" value={total === 0 ? 0 : (auto / total) * 100} format={(v) => `${Math.round(v)} %`} />}</p>
              <p className="mt-1.5 text-[12.5px] text-ink-2">{h ? h.label : `${auto} von ${total} Mails`}</p>
            </>
          )}
        />
      </InnerCard>
      <ValueLegend
        className="mt-4 justify-between px-1"
        items={[
          { key: "auto", label: "Selbst erledigt", value: String(auto), color: "var(--accent)" },
          { key: "manual", label: "Mit Ihnen", value: String(manual), color: "var(--hatch)" },
        ]}
      />
    </Card>
  );
}

// ---------------------------------------------------------------- invoices

function Invoices({ data, labels }: { data: DashboardData; labels: string[] }) {
  return (
    <Card className="flex h-full flex-col p-6">
      <CardTitle icon={ReceiptText} title="Rechnungen" aside={<CornerLink to="/rechnungen" label="Zu den Rechnungen" />} />
      <p className="mt-6 text-[40px] leading-none font-medium tracking-[-0.03em] text-ink">
        <CountUp id="overview.invoices" value={data.current.invoiceGrossCents} format={(v) => euroOf(v)} />
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-[12.5px] text-ink-2">
        <DeltaChip value={data.current.invoiceGrossCents} previous={data.previous.invoiceGrossCents} kind="cents" />
        <span>
          {data.current.invoices} {data.current.invoices === 1 ? "Beleg" : "Belege"} geprüft
        </span>
      </div>
      <div className="mt-auto pt-5">
        <SparkBars points={data.days.map((d, i) => ({ label: labels[i] ?? d.date, value: d.invoiceGrossCents }))} format={(v) => formatCents(v)} ariaLabel="Rechnungsbetrag je Tag" height={104} />
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- feed

const OUTCOME: Record<DashboardOutcome, { label: string; icon: LucideIcon; tone: string }> = {
  auto: { label: "Abgelegt", icon: FolderCheck, tone: "text-ink-3" },
  prepared: { label: "Entwurf bereit", icon: PenLine, tone: "text-accent-text" },
  review: { label: "Zur Prüfung", icon: CircleAlert, tone: "text-accent-text" },
  quarantine: { label: "Quarantäne", icon: ShieldAlert, tone: "text-bad" },
};

function Recent({ data, mails }: { data: DashboardData; mails: MailListItem[] }) {
  const byId = new Map(mails.map((m) => [m.id, m]));
  const rows = [...data.recent]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 4)
    .flatMap((r) => {
    const m = byId.get(r.mailId);
    return m ? [{ ...r, m }] : [];
  });
  return (
    <Card className="flex h-full flex-col p-6">
      <CardTitle icon={History} title="Zuletzt" aside={<CornerLink to="/posteingang" label="Alle Mails" />} />
      <ul className="mt-4 flex flex-col gap-1" aria-label="Letzte Mails">
        {rows.map(({ m, outcome }, i) => {
          const o = OUTCOME[outcome];
          const sender = m.from.name || m.from.address;
          return (
            <motion.li key={m.id} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.3, delay: 0.15 + i * 0.05, ease }}>
              <Link to={`/mail/${m.id}`} title={m.subject} className="press -mx-2 flex items-center gap-3 rounded-[18px] px-2 py-2 hover:bg-surface-2">
                <MailAvatar name={sender} category={m.category} status={m.status} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-medium text-ink">{sender}</span>
                  <span className={cn("mt-0.5 flex items-center gap-1.5 text-[12.5px]", o.tone)}>
                    <o.icon className="size-3.5 shrink-0" aria-hidden />
                    {o.label}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  {m.grossCents !== null && <span className="tnum block text-[13.5px] font-medium text-ink">{formatCents(m.grossCents)}</span>}
                  <span className="tnum block text-[12px] text-ink-3">{formatListTime(m.date)}</span>
                </span>
              </Link>
            </motion.li>
          );
        })}
      </ul>
    </Card>
  );
}

// ---------------------------------------------------------------- page

function OverviewSkeleton() {
  return (
    <div aria-busy="true" aria-label="Wird geladen" className="grid gap-4 lg:grid-cols-12">
      <Skeleton className="h-[372px] rounded-[28px] lg:col-span-8" />
      <Skeleton className="h-[372px] rounded-[28px] lg:col-span-4" />
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-[330px] rounded-[28px] lg:col-span-4" />
      ))}
    </div>
  );
}

export function OverviewPage() {
  usePageTitle("Übersicht");
  const [days, setDays] = useState<"7" | "14">("7");
  const { data, error, loading, reload } = useApi<DashboardData>(`/api/dashboard?days=${days}`);
  const mails = useApi<MailListItem[]>("/api/mails");
  const labels = data?.days.map((d) => formatDayLong(d.date)) ?? [];

  return (
    <PageScroll>
      <div className="flex flex-col gap-4 pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-[32px] leading-tight font-medium tracking-[-0.03em] text-ink">Übersicht</h1>
          <p className="mt-1 text-[14px] text-ink-2">
            {greeting()}, Jonas.{data && ` ${data.current.mails} Mails in ${days} Tagen.`}
          </p>
        </div>
        <Segmented
          label="Zeitraum"
          value={days}
          onChange={setDays}
          options={[
            { value: "7", label: "7 Tage" },
            { value: "14", label: "14 Tage" },
          ]}
        />
      </div>

      {error && <ErrorNote message={error} onRetry={reload} />}
      {loading && !data && <OverviewSkeleton />}
      {data && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          <Cell index={0} className="lg:col-span-8 lg:h-[372px]">
            <Hero data={data} days={days} />
          </Cell>
          <Cell index={1} className="lg:col-span-4 lg:h-[372px]">
            <Waiting data={data} mails={mails.data ?? []} />
          </Cell>
          <Cell index={2} className="lg:col-span-4 lg:h-[330px]">
            <Automation key={days} data={data} />
          </Cell>
          <Cell index={3} className="lg:col-span-4 lg:h-[330px]">
            <Invoices key={days} data={data} labels={labels} />
          </Cell>
          <Cell index={4} className="lg:col-span-4 lg:h-[330px]">
            <Recent data={data} mails={mails.data ?? []} />
          </Cell>
        </div>
      )}
    </PageScroll>
  );
}
