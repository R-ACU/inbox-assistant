/**
 * Building blocks of the mail-program layout: rounded panels for list, reading pane and actions,
 * list rows with a sliding selection, the empty reading pane and j/k navigation through a list.
 */
import { ArrowLeft, MailOpen } from "lucide-react";
import { LayoutGroup, motion } from "motion/react";
import type { ReactNode } from "react";
import { navigate } from "../../lib";
import { cn } from "../../utils";
import { Link } from "../common";
import { spring } from "../motion";
import { useShortcuts } from "../shell/AppShell";
import { Button } from "../ui/button";
import { Kbd } from "../ui/misc";

/**
 * Wide screens: list, reading pane and (inside the pane) the action column, each a rounded panel that scrolls on its own.
 * Below lg only one of list or pane is shown, chosen by `showPane`.
 */
export function Workspace({ list, pane, showPane }: { list: ReactNode; pane: ReactNode; showPane: boolean }) {
  return (
    <div className="flex h-full gap-3 px-3 lg:px-0">
      <div className={cn("w-full shrink-0 lg:block lg:w-[340px] xl:w-[356px]", showPane ? "hidden" : "block")}>{list}</div>
      <div className={cn("min-w-0 flex-1 lg:block", showPane ? "block" : "hidden")}>{pane}</div>
    </div>
  );
}

export function Panel({ children, className, as: As = "section", ...rest }: { children: ReactNode; className?: string; as?: "section" | "div" | "aside" | "article"; "aria-label"?: string; "aria-labelledby"?: string }) {
  return (
    <As className={cn("flex flex-col overflow-hidden rounded-[28px] bg-surface shadow-card lg:h-full", className)} {...rest}>
      {children}
    </As>
  );
}

export function ListPanel({ title, aside, toolbar, children }: { title: string; aside?: ReactNode; toolbar?: ReactNode; children: ReactNode }) {
  return (
    <Panel aria-label={title}>
      <header className="shrink-0 px-5 pt-5 pb-3">
        <div className="flex h-9 items-center justify-between gap-3">
          <h1 className="pl-1 text-[22px] font-medium tracking-[-0.015em] text-ink">{title}</h1>
          {aside}
        </div>
        {toolbar && <div className="mt-4">{toolbar}</div>}
      </header>
      <div className="scroll-quiet min-h-0 flex-1 overflow-y-auto px-2.5 pb-3">{children}</div>
    </Panel>
  );
}

/** List with a selection marker that slides between rows. Rows keep a 4 px gap so hover and selection never touch. */
export function RowList({ label, children, id }: { label: string; children: ReactNode; id: string }) {
  return (
    <LayoutGroup id={id}>
      <ul aria-label={label} className="flex flex-col gap-1">
        {children}
      </ul>
    </LayoutGroup>
  );
}

/**
 * A row leaves by sliding out and folding to height 0. `animate` names every value `exit` touches (x and
 * height too): a row can come back before it has left the DOM, for example when back and forward flip
 * between two tabs, and motion then only resets the values the target names. Without x and height here
 * the returning rows kept height 0 and lay on top of each other.
 */
const ROW_SHOWN = { opacity: 1, x: 0, y: 0, height: "auto" } as const;
const ROW_GONE = { opacity: 0, x: -28, height: 0, transition: { duration: 0.26, ease: [0.23, 1, 0.32, 1] } } as const;

export function Row({ id, href, active, children, label }: { id: string; href: string; active: boolean; children: ReactNode; label?: string }) {
  return (
    <motion.li
      layout="position"
      data-row={id}
      initial={{ opacity: 0, y: 6 }}
      animate={ROW_SHOWN}
      exit={ROW_GONE}
      transition={{ duration: 0.24, ease: [0.23, 1, 0.32, 1] }}
    >
      <Link to={href} aria-current={active ? "true" : undefined} aria-label={label} className={cn("press relative flex items-center gap-3 rounded-[20px] px-3 py-3", active ? "" : "hover:bg-surface-2")}>
        {active && <motion.span layoutId="row-active" transition={spring} className="absolute inset-0 rounded-[20px] bg-accent-soft" />}
        <span className="relative flex min-w-0 flex-1 items-center gap-3">{children}</span>
      </Link>
    </motion.li>
  );
}

export function ReaderEmpty({ title, icon: Icon = MailOpen, children }: { title: string; icon?: typeof MailOpen; children?: ReactNode }) {
  return (
    <Panel>
      <div className="grid flex-1 place-items-center px-6 py-16">
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.24 }} className="flex max-w-[360px] flex-col items-center text-center">
          <motion.span
            initial={{ scale: 0.7 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", duration: 0.45, bounce: 0.4 }}
            className="grid size-16 place-items-center rounded-full bg-surface-2 text-ink-2"
          >
            <Icon className="size-7" strokeWidth={1.7} aria-hidden />
          </motion.span>
          <p className="mt-4 text-[16px] font-semibold text-ink">{title}</p>
          {children && <div className="mt-1.5 text-[13.5px] leading-relaxed text-ink-2">{children}</div>}
          <p className="mt-6 inline-flex items-center gap-2 text-[12.5px] text-ink-3">
            <Kbd>j</Kbd> <Kbd>k</Kbd> blättern
          </p>
        </motion.div>
      </div>
    </Panel>
  );
}

export function BackButton({ to, label }: { to: string; label: string }) {
  return (
    <Button variant="ghost" size="sm" className="-ml-1.5 mb-3 lg:hidden" icon={<ArrowLeft aria-hidden />} onClick={() => navigate(to)}>
      {label}
    </Button>
  );
}

/** j/k move through `ids`; the selection is part of the URL, so back and forward work. */
export function useListKeys(ids: string[], current: string | undefined, hrefFor: (id: string) => string, extra?: { e?: () => void }) {
  const move = (step: number) => {
    if (ids.length === 0) return;
    const i = current ? ids.indexOf(current) : -1;
    const next = ids[Math.min(ids.length - 1, Math.max(0, i === -1 ? 0 : i + step))];
    if (next && next !== current) {
      navigate(hrefFor(next));
      requestAnimationFrame(() => document.querySelector(`[data-row="${next}"]`)?.scrollIntoView({ block: "nearest" }));
    }
  };
  useShortcuts({ j: () => move(1), k: () => move(-1), ...extra });
}
