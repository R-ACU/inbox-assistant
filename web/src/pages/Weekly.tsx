/**
 * One calendar week as a picture: days as columns, the time of day from top to bottom, every mail as the face
 * (or trade icon) of its sender at the hour it came in, ringed in the colour of its kind. Beside it the week in
 * four numbers and what is still open. Arrows switch weeks.
 */
import { ArrowLeft, ArrowRight, CalendarDays, ChevronRight, FolderCheck, Inbox, ListTodo, Send } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { CATEGORIES } from "../categories";
import type { MailListItem, WeeklySummary } from "../../../src/shared/types";
import { ValueLegend } from "../components/charts/charts";
import { CATEGORY_COLOR, EmptyState, ErrorNote, Link, MailAvatar } from "../components/common";
import { StatusBadge } from "../components/mail/parts";
import { CountUp } from "../components/motion";
import { PageScroll, usePageTitle } from "../components/shell/AppShell";
import { Card } from "../components/ui/card";
import { Skeleton } from "../components/ui/misc";
import { Tooltip } from "../components/ui/tooltip";
import { CATEGORY_LABEL, STATUS_LABEL, formatCents, formatDayLong, useApi } from "../lib";
import { cn } from "../utils";

type Weekly = WeeklySummary & { weeks: string[] };
const ease = [0.23, 1, 0.32, 1] as const;

const berlin = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
function local(iso: string) {
  const p = Object.fromEntries(berlin.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hours: Number(p.hour) + Number(p.minute) / 60, time: `${p.hour}:${p.minute}` };
}
const weekday = new Intl.DateTimeFormat("de-DE", { weekday: "short", timeZone: "UTC" });
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const todayBerlin = () => local(new Date().toISOString()).date;

function Cell({ index, className, children }: { index: number; className?: string; children: ReactNode }) {
  return (
    <motion.div className={cn("min-w-0", className)} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: index * 0.05, ease }}>
      {children}
    </motion.div>
  );
}

function RoundNav({ label, disabled, onClick, children }: { label: string; disabled: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <Tooltip content={label}>
      <button type="button" aria-label={label} disabled={disabled} onClick={onClick} className="press grid size-11 place-items-center rounded-full bg-surface text-ink shadow-card hover:bg-surface-2 disabled:opacity-40 disabled:shadow-none">
        {children}
      </button>
    </Tooltip>
  );
}

// ---------------------------------------------------------------- calendar

const BUBBLE = 34;

function Calendar({ w, mails }: { w: Weekly; mails: MailListItem[] }) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(w.weekStart, i));
  const today = todayBerlin();
  const placed = useMemo(() => {
    const inWeek = mails.map((m) => ({ m, ...local(m.date) })).filter((x) => x.date >= w.weekStart && x.date <= w.weekEnd);
    const minH = Math.min(7, ...inWeek.map((x) => Math.floor(x.hours)));
    const maxH = Math.max(19, ...inWeek.map((x) => Math.ceil(x.hours) + 1));
    return { inWeek: inWeek.sort((a, b) => a.hours - b.hours), start: Math.max(0, minH), end: Math.min(24, maxH) };
  }, [mails, w.weekStart, w.weekEnd]);
  const span = placed.end - placed.start;
  const height = 380;
  const y = (h: number) => ((h - placed.start) / span) * height;
  const hourMarks = Array.from({ length: Math.floor(span / 2) + 1 }, (_, i) => placed.start + i * 2).filter((h) => h <= placed.end);

  // Mails close in time on the same day sit next to each other instead of on top of each other.
  const offsets = new Map<string, number>();
  for (const d of days) {
    let lastY = -Infinity;
    let shift = 0;
    for (const x of placed.inWeek.filter((p) => p.date === d)) {
      const top = y(x.hours);
      shift = top - lastY < BUBBLE * 0.8 ? shift + 1 : 0;
      if (shift === 0) lastY = top;
      offsets.set(x.m.id, shift);
    }
  }

  return (
    <Card className="flex h-full flex-col p-6">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <div className="flex items-center gap-3">
          <span aria-hidden className="grid size-10 place-items-center rounded-full bg-accent-soft text-accent-text">
            <CalendarDays className="size-[18px]" strokeWidth={1.9} />
          </span>
          <h2 className="text-[16px] font-medium tracking-[-0.01em] text-ink">Eingang</h2>
        </div>
        <ValueLegend items={CATEGORIES.map((c) => ({ key: c, label: CATEGORY_LABEL[c], value: String(w.totals.byCategory[c]), color: CATEGORY_COLOR[c].fill }))} />
      </div>
      <div className="mt-6 grid grid-cols-[44px_repeat(7,minmax(0,1fr))]">
        <span />
        {days.map((d) => {
          const isToday = d === today;
          return (
            <div key={d} className="flex justify-center pb-3">
              <span className={cn("flex w-[52px] flex-col items-center rounded-[16px] py-1.5", isToday ? "bg-track" : "")}>
                <span className={cn("text-[12.5px]", isToday ? "font-medium text-ink" : "text-ink-3")}>{weekday.format(new Date(`${d}T12:00:00Z`)).replace(".", "")}</span>
                <span className={cn("tnum text-[15px] font-medium", isToday ? "text-ink" : "text-ink-2")}>{Number(d.slice(8))}</span>
              </span>
            </div>
          );
        })}
        <div className="relative" style={{ height }}>
          {hourMarks.map((h) => (
            <span key={h} className="tnum absolute right-2 -translate-y-1/2 text-[11.5px] text-ink-3" style={{ top: y(h) }}>
              {String(h).padStart(2, "0")}:00
            </span>
          ))}
        </div>
        {days.map((d, di) => (
          <div key={d} className="relative" style={{ height }}>
            <span aria-hidden className="absolute inset-y-0 left-1/2 border-l border-dashed border-line-strong opacity-70" />
            {placed.inWeek
              .filter((x) => x.date === d)
              .map((x, i) => {
                const sender = x.m.from.name || x.m.from.address;
                const shift = offsets.get(x.m.id) ?? 0;
                return (
                  <motion.div
                    key={x.m.id}
                    className="absolute"
                    style={{ top: y(x.hours) - BUBBLE / 2, left: `calc(50% - ${BUBBLE / 2}px + ${shift * 20}px)`, zIndex: 10 - shift }}
                    initial={{ opacity: 0, scale: 0.5 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ type: "spring", duration: 0.45, bounce: 0.35, delay: 0.1 + di * 0.04 + i * 0.03 }}
                  >
                    <Tooltip
                      content={
                        <span className="flex max-w-[260px] flex-col gap-0.5 font-normal">
                          <span className="font-medium">{x.m.subject}</span>
                          <span className="opacity-75">
                            {x.time} · {STATUS_LABEL[x.m.status]}
                          </span>
                        </span>
                      }
                    >
                      <Link
                        to={`/mail/${x.m.id}`}
                        aria-label={`${sender}, ${x.time}, ${x.m.subject}`}
                        className="press block rounded-full transition-transform duration-200 hover:z-20 hover:scale-110"
                      >
                        <span className="block rounded-full" style={{ boxShadow: `0 0 0 2.5px var(--surface), 0 0 0 5px ${CATEGORY_COLOR[x.m.category].fill}` }}>
                          <MailAvatar name={sender} category={x.m.category} status={x.m.status} size="sm" className="size-[34px]" />
                        </span>
                      </Link>
                    </Tooltip>
                  </motion.div>
                );
              })}
          </div>
        ))}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- numbers and open items

function Stat({ icon: Icon, label, value, note }: { icon: typeof Inbox; label: string; value: number; note?: string }) {
  return (
    <div className="flex flex-col gap-3 rounded-[22px] bg-surface-2 p-4">
      <span aria-hidden className="grid size-9 place-items-center rounded-full bg-surface text-ink-2">
        <Icon className="size-4" strokeWidth={1.9} />
      </span>
      <div>
        <p className="text-[30px] leading-none font-medium tracking-[-0.03em] text-ink">
          <CountUp id={`week.${label}`} value={value} />
        </p>
        <p className="mt-1.5 truncate text-[12.5px] text-ink-2">
          {label}
          {note && <span className="tnum text-ink-3"> · {note}</span>}
        </p>
      </div>
    </div>
  );
}

function Numbers({ w }: { w: Weekly }) {
  const t = w.totals;
  return (
    <Card className="p-3">
      <div className="grid grid-cols-2 gap-2">
        <Stat icon={Inbox} label="Eingang" value={t.mails} />
        <Stat icon={FolderCheck} label="Abgelegt" value={t.invoicesFiled} note={t.invoicesFiled > 0 ? formatCents(t.invoicesGrossCents) : undefined} />
        <Stat icon={Send} label="Gesendet" value={t.sent} />
        <Stat icon={ListTodo} label="Offen" value={t.awaitingApproval + t.openReview + t.quarantined} />
      </div>
    </Card>
  );
}

function Open({ w, mails }: { w: Weekly; mails: MailListItem[] }) {
  const byId = new Map(mails.map((m) => [m.id, m]));
  return (
    <Card className="p-6">
      <h2 className="text-[16px] font-medium text-ink">Noch offen</h2>
      {w.attention.length === 0 ? (
        <p className="mt-3 text-[13.5px] text-ink-2">Alles erledigt.</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-1">
          {w.attention.map((a, i) => {
            const m = byId.get(a.mailId);
            const sender = m ? m.from.name || m.from.address : a.subject;
            const href = a.status === "awaiting_approval" ? `/freigabe/${a.mailId}` : `/pruefliste/${a.mailId}`;
            return (
              <motion.li key={a.mailId} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.3, delay: 0.15 + i * 0.05, ease }}>
                <Link to={href} title={a.reason} className="press group -mx-2 flex items-center gap-3 rounded-[18px] px-2 py-2 hover:bg-surface-2">
                  {m ? <MailAvatar name={sender} category={m.category} status={m.status} /> : null}
                  <span className="min-w-0 flex-1 truncate text-[14px] text-ink">{a.subject}</span>
                  <StatusBadge status={a.status} short />
                  <ChevronRight className="size-4 shrink-0 text-ink-3 transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden />
                </Link>
              </motion.li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

export function WeeklyPage() {
  usePageTitle("Woche");
  const [week, setWeek] = useState<string | null>(null);
  const { data, error, loading, reload } = useApi<Weekly>(week ? `/api/weekly?week=${week}` : "/api/weekly");
  const mails = useApi<MailListItem[]>("/api/mails");
  const w = data;
  // A demo looked at later should not open on an empty week: without a chosen week, jump to the latest one with mail.
  useEffect(() => {
    if (!week && data && data.weeks.length > 0 && !data.weeks.includes(data.weekStart)) setWeek(data.weeks.at(-1)!);
  }, [week, data]);
  const idx = w ? w.weeks.indexOf(w.weekStart) : -1;
  const prev = w ? (idx > 0 ? w.weeks[idx - 1] : idx === -1 ? w.weeks.filter((x) => x < w.weekStart).at(-1) : undefined) : undefined;
  const next = w ? (idx >= 0 && idx < w.weeks.length - 1 ? w.weeks[idx + 1] : idx === -1 ? w.weeks.find((x) => x > w.weekStart) : undefined) : undefined;

  return (
    <PageScroll>
      <div className="flex flex-col gap-4 pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-[32px] leading-tight font-medium tracking-[-0.03em] text-ink">Woche</h1>
          <p className="mt-1 text-[14px] text-ink-2">
            {w && w.weeks.length > 0 ? (
              <>
                KW {Number(w.isoWeek.split("W")[1])} · {formatDayLong(w.weekStart)} bis {formatDayLong(w.weekEnd)}
              </>
            ) : (
              " "
            )}
          </p>
        </div>
        {w && w.weeks.length > 0 && (
          <div className="flex items-center gap-2">
            <RoundNav label="Vorherige Woche" disabled={!prev} onClick={() => prev && setWeek(prev)}>
              <ArrowLeft className="size-[18px]" aria-hidden />
            </RoundNav>
            <RoundNav label="Nächste Woche" disabled={!next} onClick={() => next && setWeek(next)}>
              <ArrowRight className="size-[18px]" aria-hidden />
            </RoundNav>
          </div>
        )}
      </div>
      {error && <ErrorNote message={error} onRetry={reload} />}
      {loading && !data && (
        <div aria-busy="true" aria-label="Wird geladen" className="grid gap-4 lg:grid-cols-12">
          <Skeleton className="h-[520px] rounded-[28px] lg:col-span-8" />
          <Skeleton className="h-[520px] rounded-[28px] lg:col-span-4" />
        </div>
      )}
      {w && w.weeks.length === 0 && (
        <Card>
          <EmptyState icon={CalendarDays} title="Noch keine Woche mit Mails." />
        </Card>
      )}
      <AnimatePresence mode="wait" initial={false}>
        {w && w.weeks.length > 0 && (
          <motion.div key={w.weekStart} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }} className="grid grid-cols-1 gap-4 lg:grid-cols-12">
            <Cell index={0} className="lg:col-span-8">
              <Calendar w={w} mails={mails.data ?? []} />
            </Cell>
            <div className="flex min-w-0 flex-col gap-4 lg:col-span-4">
              <Cell index={1}>
                <Numbers w={w} />
              </Cell>
              <Cell index={2} className="flex-1 [&>*]:h-full">
                <Open w={w} mails={mails.data ?? []} />
              </Cell>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </PageScroll>
  );
}
