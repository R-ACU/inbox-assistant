/**
 * The mailbox: one list with three tabs (Freigabe, Prüfen, Alle) and one reading pane for every kind of mail.
 * Each tab has its own URL (/freigabe, /pruefliste, /posteingang), the selected mail is part of it, so links,
 * back and forward and j/k all work. The search field in the top bar filters the list through ?q=.
 */
import { CheckCheck, Inbox, PartyPopper, Search, ShieldCheck, TriangleAlert, X } from "lucide-react";
import { AnimatePresence } from "motion/react";
import { useMemo, useState } from "react";
import type { Category } from "../../../src/shared/schemas";
import type { MailListItem, MailStatus } from "../../../src/shared/types";
import { CATEGORY_COLOR, EmptyState, ErrorNote, MailAvatar } from "../components/common";
import { MailDetail } from "../components/mail/detail";
import { ListSkeleton, STATUS_SHORT, useMediaQuery } from "../components/mail/parts";
import { ListPanel, ReaderEmpty, Row, RowList, Workspace, useListKeys } from "../components/mail/workspace";
import { usePageTitle, useRefreshCounts } from "../components/shell/AppShell";
import { Badge, Dot } from "../components/ui/badge";
import { Segmented } from "../components/ui/segmented";
import { Select, type Option } from "../components/ui/select";
import { Tooltip } from "../components/ui/tooltip";
import { CATEGORY_LABEL, formatCents, formatListTime, navigate, useApi, useSearch } from "../lib";
import { cn } from "../utils";

export type MailTab = "freigabe" | "pruefen" | "alle";

const TAB: Record<MailTab, { label: string; list: string; item: (id: string) => string; listLabel: string }> = {
  freigabe: { label: "Freigabe", list: "/freigabe", item: (id) => `/freigabe/${id}`, listLabel: "Freigabe" },
  pruefen: { label: "Prüfen", list: "/pruefliste", item: (id) => `/pruefliste/${id}`, listLabel: "Prüfen" },
  alle: { label: "Alle", list: "/posteingang", item: (id) => `/mail/${id}`, listLabel: "Mails" },
};

const REVIEW_ORDER: Partial<Record<MailStatus, number>> = { delivery_failed: 0, needs_review: 1, quarantined: 2 };
const byDateAsc = (a: MailListItem, b: MailListItem) => a.date.localeCompare(b.date);

function inTab(tab: MailTab, m: MailListItem) {
  if (tab === "freigabe") return m.status === "awaiting_approval";
  if (tab === "pruefen") return m.status === "needs_review" || m.status === "quarantined" || m.status === "delivery_failed";
  return true;
}

type Filter = "all" | Category;
const FILTERS: Option<Filter>[] = [
  { value: "all", label: "Alle Arten" },
  ...(["invoice", "inquiry", "other", "suspicious"] as const).map((c) => ({ value: c, label: CATEGORY_LABEL[c], icon: <Dot className={cn("size-2.5", CATEGORY_COLOR[c].bg)} /> })),
];

const CHIP_TONE: Partial<Record<MailStatus, "accent" | "bad">> = { awaiting_approval: "accent", needs_review: "accent", quarantined: "bad", delivery_failed: "bad" };

/** Right end of a row: what needs doing (only in "Alle"), a flagged draft, or the invoice amount. */
function RowEnd({ m, tab }: { m: MailListItem; tab: MailTab }) {
  const chip = STATUS_SHORT[m.status];
  if (tab === "alle" && chip) return <Badge tone={CHIP_TONE[m.status] ?? "neutral"}>{chip}</Badge>;
  if (tab === "pruefen" && (m.status === "quarantined" || m.status === "delivery_failed")) return <Badge tone="bad">{chip}</Badge>;
  if (tab === "freigabe" && m.findingCount > 0)
    return (
      <Tooltip content={m.findingCount === 1 ? "1 Hinweis im Entwurf" : `${m.findingCount} Hinweise im Entwurf`}>
        <span className="grid size-6 place-items-center rounded-full bg-bad-soft text-bad" role="img" aria-label={m.findingCount === 1 ? "1 Hinweis" : `${m.findingCount} Hinweise`}>
          <TriangleAlert className="size-3.5" aria-hidden />
        </span>
      </Tooltip>
    );
  if (m.grossCents !== null) return <span className="tnum text-[13px] font-medium text-ink">{formatCents(m.grossCents)}</span>;
  return null;
}

function MailRow({ m, tab, active, href }: { m: MailListItem; tab: MailTab; active: boolean; href: string }) {
  const sender = m.from.name || m.from.address;
  return (
    <Row id={m.id} href={href} active={active}>
      <MailAvatar name={sender} category={m.category} status={m.status} />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-3">
          <span className="truncate text-[14px] font-medium text-ink">{sender}</span>
          <span className="tnum shrink-0 text-[12px] text-ink-3">{formatListTime(m.date)}</span>
        </span>
        <span className="mt-0.5 flex items-center gap-2">
          <span data-part="subject" title={m.subject} className="min-w-0 flex-1 truncate text-[13px] text-ink-2">
            {m.subject}
          </span>
          <RowEnd m={m} tab={tab} />
        </span>
      </span>
    </Row>
  );
}

const EMPTY: Record<MailTab, { icon: typeof Inbox; title: string }> = {
  freigabe: { icon: CheckCheck, title: "Alles freigegeben." },
  pruefen: { icon: ShieldCheck, title: "Nichts zu prüfen." },
  alle: { icon: Inbox, title: "Noch keine Mails." },
};

export function MailboxPage({ tab, selectedId }: { tab: MailTab; selectedId?: string }) {
  usePageTitle(TAB[tab].label === "Alle" ? "Posteingang" : TAB[tab].label);
  const { data, error, loading, reload } = useApi<MailListItem[]>("/api/mails");
  const refreshCounts = useRefreshCounts();
  const search = useSearch();
  const query = (new URLSearchParams(search).get("q") ?? "").slice(0, 100);
  const [filter, setFilter] = useState<Filter>("all");
  const suffix = query ? `?q=${encodeURIComponent(query)}` : "";

  const counts = useMemo(() => {
    const all = data ?? [];
    return { freigabe: all.filter((m) => inTab("freigabe", m)).length, pruefen: all.filter((m) => inTab("pruefen", m)).length, alle: all.length };
  }, [data]);

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = (data ?? []).filter((m) => inTab(tab, m));
    if (tab === "freigabe") list = [...list].sort(byDateAsc);
    if (tab === "pruefen") list = [...list].sort((a, b) => (REVIEW_ORDER[a.status] ?? 9) - (REVIEW_ORDER[b.status] ?? 9) || byDateAsc(a, b));
    if (tab === "alle" && filter !== "all") list = list.filter((m) => m.category === filter);
    if (q) list = list.filter((m) => `${m.from.name} ${m.from.address} ${m.subject} ${m.preview}`.toLowerCase().includes(q));
    return list;
  }, [data, tab, filter, query]);

  const current = selectedId ?? items[0]?.id;
  // Side by side the first mail opens by itself; on a phone the list stands alone, so nothing is marked until a mail is opened.
  const sideBySide = useMediaQuery("(min-width: 1024px)");
  const marked = sideBySide ? current : selectedId;
  const currentItem = data?.find((m) => m.id === current);
  const href = (id: string) => TAB[tab].item(id) + suffix;

  useListKeys(
    items.map((m) => m.id),
    current,
    href,
    tab === "alle" ? { e: () => navigate(currentItem?.status === "awaiting_approval" ? `/freigabe/${currentItem.id}` : "/freigabe") } : undefined,
  );

  const afterAction = () => {
    const i = items.findIndex((m) => m.id === current);
    const rest = items.filter((m) => m.id !== current && inTab(tab, m));
    const next = tab === "alle" ? current : (rest[Math.min(Math.max(i, 0), rest.length - 1)]?.id ?? null);
    reload();
    refreshCounts();
    if (tab !== "alle") navigate(next ? TAB[tab].item(next) + suffix : TAB[tab].list + suffix);
  };

  const tabs = (
    <Segmented
      role="tablist"
      label="Ansicht"
      fill
      value={tab}
      onChange={(t) => navigate(TAB[t].list + suffix)}
      options={(["freigabe", "pruefen", "alle"] as const).map((t) => ({ value: t, label: TAB[t].label, count: data ? counts[t] : undefined }))}
    />
  );

  const toolbar = (
    <div className="flex flex-col gap-3">
      {tabs}
      <AnimatePresence initial={false}>
        {query && (
          <div className="flex items-center gap-2 px-1 text-[13px]">
            <Search className="size-3.5 text-ink-3" aria-hidden />
            <span className="min-w-0 truncate text-ink-2">„{query}“</span>
            <button
              type="button"
              onClick={() => navigate(TAB[tab].list)}
              aria-label="Suche aufheben"
              className="press ml-auto grid size-7 place-items-center rounded-full text-ink-3 hover:bg-surface-2 hover:text-ink"
            >
              <X className="size-3.5" aria-hidden />
            </button>
          </div>
        )}
      </AnimatePresence>
    </div>
  );

  const empty = EMPTY[tab];
  const list = (
    <ListPanel title="Posteingang" aside={tab === "alle" ? <Select variant="pill" label="Kategorie" value={filter} options={FILTERS} onChange={setFilter} /> : undefined} toolbar={toolbar}>
      {error && <ErrorNote message={error} onRetry={reload} />}
      {loading && !data && <ListSkeleton rows={7} />}
      {data && items.length === 0 && (
        <EmptyState icon={query || filter !== "all" ? Search : empty.icon} tone={query || filter !== "all" || tab === "alle" ? "neutral" : "good"} title={query || filter !== "all" ? "Keine Mail passt dazu." : empty.title} />
      )}
      {items.length > 0 && (
        <RowList id={`list-${tab}`} label={TAB[tab].listLabel}>
          <AnimatePresence initial={false}>
            {items.map((m) => (
              <MailRow key={m.id} m={m} tab={tab} active={m.id === marked} href={href(m.id)} />
            ))}
          </AnimatePresence>
        </RowList>
      )}
    </ListPanel>
  );

  return (
    <Workspace
      showPane={!!selectedId}
      list={list}
      pane={
        current ? (
          <MailDetail
            id={current}
            back={{ to: TAB[tab].list + suffix, label: "Posteingang" }}
            onDone={afterAction}
            // A requested draft waits in Freigabe like every other draft: open it there (in place of this entry, so back skips it).
            onReplyReady={(drafted) => {
              reload();
              navigate(TAB.freigabe.item(drafted), { replace: true });
            }}
          />
        ) : (
          <ReaderEmpty
            title={!data ? "Wird geladen" : query || filter !== "all" ? "Keine Treffer." : empty.title}
            icon={!data ? Inbox : query || filter !== "all" ? Search : tab !== "alle" ? PartyPopper : Inbox}
          />
        )
      }
    />
  );
}
