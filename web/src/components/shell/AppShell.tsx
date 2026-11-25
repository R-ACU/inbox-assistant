/**
 * App shell in the style of a mail program: a narrow icon rail on the left (tooltips, counters),
 * a slim top bar, and the views as rounded panels on a calm canvas. Phones get a bottom tab bar.
 * Also home of the keyboard shortcuts (j/k, e, /, ?), the counters and the page title.
 */
import { CalendarRange, ChevronDown, GitCompareArrows, Inbox, Keyboard, LayoutGrid, LogOut, Moon, PaintRoller, ReceiptText, Search, Sun, X, type LucideIcon } from "lucide-react";
import { AnimatePresence, LayoutGroup, motion, PresenceContext } from "motion/react";
import { createContext, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { ROUTES, t } from "../../i18n";
import { navigate, useApi, usePath, useSearch } from "../../lib";
import { companyOf, currentTheme, getMode, setMode, subscribeMode } from "../../theme";
import { cn } from "../../utils";
import { BrandGlyph } from "../brand";
import { Avatar, Link } from "../common";
import { spring } from "../motion";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { Menu, MenuItem, MenuLabel, MenuSeparator } from "../ui/dropdown-menu";
import { Kbd } from "../ui/misc";
import { Tooltip } from "../ui/tooltip";

export interface Counts {
  awaitingApproval: number;
  openReview: number;
  quarantined: number;
  total: number;
}

const CountsContext = createContext<{ counts: Counts | null; refresh: () => void }>({ counts: null, refresh: () => {} });
export const useCounts = () => useContext(CountsContext);
export const useRefreshCounts = () => useContext(CountsContext).refresh;

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  count?: (c: Counts) => number;
  /** Other paths that belong to this area. */
  also?: string[];
}

/**
 * Five areas. Approval, review list and all mail are tabs of one mailbox (one list, one reading pane),
 * so a draft, an invoice and a suspicious mail are all handled in the same place.
 */
export const NAV: NavItem[] = [
  { to: ROUTES.overview, label: t("Übersicht", "Overview"), icon: LayoutGrid },
  {
    to: ROUTES.approval,
    label: t("Posteingang", "Inbox"),
    icon: Inbox,
    count: (c) => c.awaitingApproval + c.openReview + c.quarantined,
    also: [ROUTES.review, ROUTES.inbox, ROUTES.mail],
  },
  { to: ROUTES.invoices, label: t("Rechnungen", "Invoices"), icon: ReceiptText },
  { to: ROUTES.week, label: t("Woche", "Week"), icon: CalendarRange },
  { to: ROUTES.reconcile, label: t("Abgleich", "Reconcile"), icon: GitCompareArrows },
];

export function isActive(path: string, item: NavItem) {
  if (item.to === ROUTES.overview) return path === ROUTES.overview;
  return [item.to, ...(item.also ?? [])].some((to) => path === to || path.startsWith(`${to}/`));
}

// ---------------------------------------------------------------- page title

const APP_NAME = t("Hofmann & Kraft", "Brennan & Doyle");
export function usePageTitle(title: string) {
  useEffect(() => {
    document.title = `${title} | ${APP_NAME}`;
  }, [title]);
}

// ---------------------------------------------------------------- mode

export function useMode() {
  return useSyncExternalStore(subscribeMode, getMode);
}

export function ModeToggle({ className }: { className?: string }) {
  const mode = useMode();
  const dark = mode === "dark";
  const label = dark ? t("Helles Design", "Light mode") : t("Dunkles Design", "Dark mode");
  return (
    <Tooltip content={label} side="bottom">
      <Button variant="ghost" size="icon" className={cn("relative overflow-hidden", className)} aria-label={label} onClick={() => setMode(dark ? "light" : "dark")}>
        <AnimatePresence initial={false} mode="wait">
          <motion.span
            key={mode}
            initial={{ opacity: 0, rotate: -60, scale: 0.7 }}
            animate={{ opacity: 1, rotate: 0, scale: 1 }}
            exit={{ opacity: 0, rotate: 60, scale: 0.7 }}
            transition={{ duration: 0.18 }}
            className="grid place-items-center"
          >
            {dark ? <Sun aria-hidden /> : <Moon aria-hidden />}
          </motion.span>
        </AnimatePresence>
      </Button>
    </Tooltip>
  );
}

// ---------------------------------------------------------------- shortcuts

type Handlers = Partial<Record<"j" | "k" | "e" | "/", () => void>>;
const ShortcutContext = createContext<{ register: (h: { current: Handlers }) => () => void; openHelp: () => void }>({
  register: () => () => {},
  openHelp: () => {},
});
export const useOpenHelp = () => useContext(ShortcutContext).openHelp;

/** Registers j/k/e and "/" for the current view. Keys are ignored while typing in a field. */
export function useShortcuts(handlers: Handlers) {
  const { register } = useContext(ShortcutContext);
  const ref = useRef(handlers);
  ref.current = handlers;
  useEffect(() => register(ref), [register]);
}

const SHORTCUTS: [string, string][] = [
  ["j", t("Nächste Mail in der Liste", "Next mail in the list")],
  ["k", t("Vorherige Mail in der Liste", "Previous mail in the list")],
  ["e", t("Zur Freigabe, dort den Knopf Senden ansteuern", "Go to approval and focus Send")],
  ["/", t("Mails durchsuchen", "Search mails")],
  ["?", t("Diese Hilfe öffnen", "Open this help")],
  ["Esc", t("Hilfe, Menü oder Auswahl schließen", "Close help, menu or selection")],
];

function ShortcutHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} title={t("Tastenkürzel", "Keyboard shortcuts")}>
      <dl className="flex flex-col gap-3">
        {SHORTCUTS.map(([k, d]) => (
          <div key={k} className="flex items-center gap-4 text-[13.5px]">
            <dt className="w-10 shrink-0">
              <Kbd>{k}</Kbd>
            </dt>
            <dd className="text-ink-2">{d}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-6 rounded-[18px] bg-surface-2 px-4 py-3 text-[12.5px] leading-relaxed text-ink-2">
        {t(
          "Senden bleibt immer ein eigener Klick oder ein Enter auf dem Knopf. Ein einzelner Buchstabe verschickt nie etwas.",
          "Sending always takes its own click or Enter on the button. A single letter never sends anything.",
        )}
      </p>
    </Dialog>
  );
}

// ---------------------------------------------------------------- brand

export function BrandMark({ size = 40 }: { size?: number }) {
  return (
    <span aria-hidden className="grid shrink-0 place-items-center rounded-full bg-accent text-accent-ink" style={{ width: size, height: size }}>
      <PaintRoller className="size-[46%]" strokeWidth={2} />
    </span>
  );
}

/** Quiet note naming the company the demo is styled for. Text comes from the fixed theme list only. */
export function DemoNote({ className }: { className?: string }) {
  const company = companyOf(currentTheme());
  if (!company) return null;
  return (
    <p className={cn("text-[12.5px] text-ink-3", className)} data-testid="theme-note">
      {t(`Demo für ${company}`, `Demo for ${company}`)}
    </p>
  );
}

function ModeBadge({ mode }: { mode: "mock" | "claude" }) {
  return (
    <Tooltip content={mode === "mock" ? t("Modellantworten aus Testdaten", "Model answers from test data") : t("Haiku sortiert, Sonnet liest und schreibt", "Haiku sorts, Sonnet reads and writes")} side="bottom">
      <Badge tone="outline" size="md" className="h-11 cursor-default gap-2 border-0 bg-surface pr-4 pl-3 text-[13px] text-ink-2 shadow-card" tabIndex={0}>
        <BrandGlyph brand="claude" className="size-[18px]" />
        {mode === "mock" ? t("Testmodus", "Mock mode") : "Claude API"}
      </Badge>
    </Tooltip>
  );
}

// ---------------------------------------------------------------- rail

function CountBubble({ count, className }: { count: number; className?: string }) {
  return (
    <AnimatePresence>
      {count > 0 && (
        <motion.span
          key={count}
          aria-hidden
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.6, opacity: 0 }}
          transition={{ type: "spring", duration: 0.3, bounce: 0.35 }}
          className={cn(
            "tnum absolute grid h-[18px] min-w-[18px] place-items-center rounded-full bg-accent px-1 text-[10.5px] font-semibold text-accent-ink ring-2 ring-surface",
            className,
          )}
        >
          {count}
        </motion.span>
      )}
    </AnimatePresence>
  );
}

function RailLink({ item, counts, path }: { item: NavItem; counts: Counts | null; path: string }) {
  const active = isActive(path, item);
  const count = counts && item.count ? item.count(counts) : 0;
  const Icon = item.icon;
  return (
    <li>
      <Tooltip
        side="right"
        content={
          <>
            {item.label}
            {count > 0 && <span className="tnum rounded-full bg-white/15 px-1.5 text-[11.5px] dark:bg-black/10">{count}</span>}
          </>
        }
      >
        <Link
          to={item.to}
          aria-current={active ? "page" : undefined}
          aria-label={count > 0 ? `${item.label} (${count})` : item.label}
          className={cn(
            "press group relative grid size-11 place-items-center rounded-full",
            active ? "text-surface dark:text-ink" : "text-ink-3 hover:bg-surface-2 hover:text-ink",
          )}
        >
          {active && <motion.span layoutId="rail-active" transition={spring} className="absolute inset-0 rounded-full bg-ink dark:bg-thumb" />}
          <Icon className="relative size-[20px]" strokeWidth={1.9} aria-hidden />
          <CountBubble count={count} className="-top-1 -right-1" />
        </Link>
      </Tooltip>
    </li>
  );
}

function RailButton({ label, icon: Icon, onClick }: { label: string; icon: LucideIcon; onClick: () => void }) {
  return (
    <Tooltip side="right" content={label}>
      <button onClick={onClick} aria-label={label} className="press grid size-11 place-items-center rounded-full text-ink-3 hover:bg-surface-2 hover:text-ink">
        <Icon className="size-[19px]" strokeWidth={1.9} aria-hidden />
      </button>
    </Tooltip>
  );
}

// ---------------------------------------------------------------- top bar

const MAIL_ROUTES = new RegExp(`^/(${[ROUTES.approval, ROUTES.review, ROUTES.inbox, ROUTES.mail].map((r) => r.slice(1)).join("|")})(/|$)`);

/** The list a mail route belongs to, without the selected mail: /freigabe/abc -> /freigabe, /mail/abc -> /posteingang. */
function listOf(path: string) {
  const first = path.split("/")[1] ?? "";
  return `/${first}` === ROUTES.mail ? ROUTES.inbox : `/${first}`;
}

/** Mail search. In the mailbox it filters the list while typing (?q= in the URL); elsewhere Enter opens the mailbox with the term. */
function SearchField() {
  const path = usePath();
  const search = useSearch();
  const inMail = MAIL_ROUTES.test(path);
  const urlQ = new URLSearchParams(search).get("q") ?? "";
  const [q, setQ] = useState(urlQ);
  const ref = useRef<HTMLInputElement>(null);
  useShortcuts({ "/": () => ref.current?.focus() });
  useEffect(() => {
    if (inMail) setQ(urlQ);
    else if (document.activeElement !== ref.current) setQ("");
  }, [urlQ, inMail]);
  const apply = (value: string) => {
    setQ(value);
    if (!inMail) return;
    const v = value.trim().slice(0, 100);
    const base = listOf(path);
    navigate(v ? `${base}?q=${encodeURIComponent(v)}` : base, { replace: true });
  };
  return (
    <form
      role="search"
      className="relative w-full max-w-[360px]"
      onSubmit={(e) => {
        e.preventDefault();
        const v = q.trim().slice(0, 100);
        if (!inMail) navigate(v ? `${ROUTES.inbox}?q=${encodeURIComponent(v)}` : ROUTES.inbox);
        ref.current?.blur();
      }}
    >
      <Search className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
      <input
        ref={ref}
        value={q}
        onChange={(e) => apply(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            apply("");
            e.currentTarget.blur();
          }
        }}
        placeholder={t("Mails durchsuchen", "Search mails")}
        aria-label={t("Mails durchsuchen", "Search mails")}
        className="h-11 w-full rounded-full border border-transparent bg-surface pr-12 pl-11 text-[13.5px] text-ink shadow-card outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-ink-3 hover:border-line-strong focus:border-accent focus:shadow-[0_0_0_3px_var(--accent-soft)] focus-visible:outline-none"
      />
      {q ? (
        <button
          type="button"
          aria-label={t("Suche leeren", "Clear search")}
          onClick={() => apply("")}
          className="press absolute top-1/2 right-2.5 grid size-7 -translate-y-1/2 place-items-center rounded-full text-ink-3 hover:bg-surface-2 hover:text-ink"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      ) : (
        <Kbd className="pointer-events-none absolute top-1/2 right-3.5 -translate-y-1/2 border-0 bg-surface-2 text-ink-3 shadow-none">/</Kbd>
      )}
    </form>
  );
}

function AccountMenu({ onLogout, onHelp }: { onLogout: () => void; onHelp: () => void }) {
  return (
    <Menu
      label={t("Konto", "Account")}
      trigger={
        <button className="press flex h-11 items-center gap-2.5 rounded-full bg-surface py-1 pr-3 pl-1 text-left shadow-card hover:bg-surface-2" aria-label={t("Konto", "Account")}>
          <Avatar name={t("Jonas Hofmann", "Conor Brennan")} size="sm" className="size-9" />
          <span className="hidden leading-tight xl:block">
            <span className="block text-[13px] font-medium text-ink">{t("Jonas Hofmann", "Conor Brennan")}</span>
            <span className="block text-[12px] text-ink-3">{t("Inhaber", "Owner")}</span>
          </span>
          <ChevronDown className="size-4 text-ink-3" aria-hidden />
        </button>
      }
    >
      <MenuLabel>{t("Malerbetrieb Hofmann & Kraft", "Brennan & Doyle Painting")}</MenuLabel>
      <MenuItem onSelect={onHelp}>
        <Keyboard aria-hidden />
        {t("Tastenkürzel", "Keyboard shortcuts")}
      </MenuItem>
      <MenuSeparator />
      <MenuItem onSelect={onLogout}>
        <LogOut aria-hidden />
        {t("Abmelden", "Sign out")}
      </MenuItem>
    </Menu>
  );
}

// ---------------------------------------------------------------- phone

function BottomTabs({ counts, path }: { counts: Counts | null; path: string }) {
  return (
    <nav aria-label={t("Schnellzugriff", "Quick access")} className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
      <LayoutGroup id="tabs">
        <ul className="mx-auto flex max-w-[560px] items-stretch justify-between gap-1 px-2 py-1.5">
          {NAV.map((item) => {
            const active = isActive(path, item);
            const count = counts && item.count ? item.count(counts) : 0;
            const Icon = item.icon;
            return (
              <li key={item.to} className="flex-1">
                <Link
                  to={item.to}
                  aria-current={active ? "page" : undefined}
                  className={cn("press relative flex h-[52px] flex-col items-center justify-center gap-0.5 rounded-[18px] text-[11px]", active ? "font-semibold text-ink" : "text-ink-3")}
                >
                  {active && <motion.span layoutId="tab-active" transition={spring} className="absolute inset-0 rounded-[18px] bg-track" />}
                  <Icon className="relative size-[19px]" strokeWidth={1.9} aria-hidden />
                  <span className="relative">{item.label}</span>
                  <CountBubble count={count} className="top-0.5 left-[calc(50%+4px)]" />
                </Link>
              </li>
            );
          })}
        </ul>
      </LayoutGroup>
    </nav>
  );
}

// ---------------------------------------------------------------- shell

/** Top-level section of a path; the view fades over only when this changes, not when a mail is picked. */
/**
 * Lets a section's content appear as it is when it is already there on the first render: that is the case
 * when the user comes back and the data comes from the view cache (useApi in lib.ts). Its entrance
 * animations would only replay and look like loading. Whatever mounts later (data that arrives, a mail that
 * opens) animates as usual, because the block covers the first render only.
 */
function NoReplay({ children }: { children: ReactNode }) {
  const presence = useContext(PresenceContext);
  const [firstRender, setFirstRender] = useState(true);
  useEffect(() => setFirstRender(false), []);
  const value = useMemo(() => (presence && firstRender ? { ...presence, initial: false as const } : presence), [presence, firstRender]);
  return <PresenceContext.Provider value={value}>{children}</PresenceContext.Provider>;
}

function sectionOf(path: string) {
  const first = path.split("/")[1] ?? "";
  return [ROUTES.mail, ROUTES.approval, ROUTES.review].includes(`/${first}`) ? ROUTES.inbox.slice(1) : first;
}

export function AppShell({ mode, onLogout, children }: { mode: "mock" | "claude"; onLogout: () => void; children: ReactNode }) {
  const path = usePath();
  const counts = useApi<Counts>("/api/overview");
  const [help, setHelp] = useState(false);
  const handlers = useRef(new Set<{ current: Handlers }>());

  useEffect(() => {
    counts.reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true'], [role='menu'], [role='dialog']")) return;
      if (e.key === "?") {
        e.preventDefault();
        setHelp(true);
        return;
      }
      const key = e.key.toLowerCase() as keyof Handlers;
      if (!["j", "k", "e", "/"].includes(key)) return;
      // The most recently mounted component that handles this key wins (the draft editor before its list).
      const fn = [...handlers.current].reverse().find((h) => h.current[key])?.current[key];
      if (fn) {
        e.preventDefault();
        fn();
      } else if (key === "e") {
        e.preventDefault();
        navigate(ROUTES.approval);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const shortcuts = useRef({
    register: (h: { current: Handlers }) => {
      handlers.current.add(h);
      return () => handlers.current.delete(h);
    },
    openHelp: () => setHelp(true),
  });

  return (
    <CountsContext.Provider value={{ counts: counts.data, refresh: counts.reload }}>
      <ShortcutContext.Provider value={shortcuts.current}>
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[100] focus:rounded-full focus:bg-surface focus:px-3 focus:py-2 focus:text-ink focus:shadow-pop">
          {t("Zum Inhalt springen", "Skip to content")}
        </a>
        <div className="min-h-dvh bg-canvas lg:grid lg:h-dvh lg:grid-cols-[84px_minmax(0,1fr)] lg:overflow-hidden">
          {/* Desktop rail */}
          <aside className="hidden h-dvh flex-col items-center justify-between py-3.5 lg:flex">
            <div className="flex flex-col items-center gap-5">
              <Tooltip side="right" content={APP_NAME}>
                <Link to={ROUTES.overview} aria-label={t("Hofmann & Kraft, zur Übersicht", "Brennan & Doyle, to overview")} className="press rounded-full">
                  <BrandMark />
                </Link>
              </Tooltip>
              <nav aria-label={t("Hauptnavigation", "Main navigation")} className="rounded-full bg-surface p-1.5 shadow-card">
                <LayoutGroup id="rail">
                  <ul className="flex flex-col items-center gap-1.5">
                    {NAV.map((item) => (
                      <RailLink key={item.to} item={item} counts={counts.data} path={path} />
                    ))}
                  </ul>
                </LayoutGroup>
              </nav>
            </div>
            <div className="flex flex-col items-center gap-1.5 rounded-full bg-surface p-1.5 shadow-card">
              <RailButton label={t("Tastenkürzel (?)", "Keyboard shortcuts (?)")} icon={Keyboard} onClick={() => setHelp(true)} />
              <RailButton label={t("Abmelden", "Sign out")} icon={LogOut} onClick={onLogout} />
            </div>
          </aside>

          <div className="flex min-w-0 flex-col lg:h-dvh">
            <header className="sticky top-0 z-30 flex h-[72px] shrink-0 items-center justify-between gap-4 bg-canvas/90 px-4 backdrop-blur sm:px-6 lg:static lg:bg-transparent lg:pr-4 lg:pl-1 lg:backdrop-blur-none">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <span className="lg:hidden">
                  <BrandMark size={34} />
                </span>
                <span className="hidden flex-1 sm:block">
                  <SearchField />
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-1.5 sm:gap-2.5">
                <DemoNote className="mr-1 hidden md:block" />
                <ModeBadge mode={mode} />
                <ModeToggle className="bg-surface shadow-card hover:bg-surface-2" />
                <AccountMenu onLogout={onLogout} onHelp={() => setHelp(true)} />
              </div>
            </header>
            <main id="main" className="relative min-h-0 min-w-0 flex-1 pb-[84px] lg:pr-4 lg:pb-4">
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={sectionOf(path)}
                  className="h-full"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.16, ease: [0.23, 1, 0.32, 1] }}
                >
                  <NoReplay>{children}</NoReplay>
                </motion.div>
              </AnimatePresence>
            </main>
          </div>
        </div>
        <BottomTabs counts={counts.data} path={path} />
        <ShortcutHelp open={help} onClose={() => setHelp(false)} />
      </ShortcutContext.Provider>
    </CountsContext.Provider>
  );
}

/** Scrolling page for dashboard-like views (not the mail columns). */
export function PageScroll({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className="scroll-quiet h-full overflow-y-auto">
      <div className={cn("mx-auto w-full max-w-[1320px] px-4 pt-2 pb-10 sm:px-6 lg:px-1", className)}>{children}</div>
    </div>
  );
}
