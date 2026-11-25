/** Small building blocks used across views: avatars, category marks, findings, errors and empty states. */
import {
  ArrowUpRight,
  BrickWall,
  Building2,
  Car,
  CircleAlert,
  CircleCheck,
  Construction,
  Hammer,
  Info,
  Landmark,
  PaintBucket,
  Paintbrush,
  Recycle,
  RefreshCw,
  ShieldAlert,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { motion } from "motion/react";
import type { MouseEvent, ReactNode } from "react";
import type { Category } from "../../../src/shared/schemas";
import type { Finding, MailStatus } from "../../../src/shared/types";
import { CATEGORY_LABEL, navigate } from "../lib";
import { cn } from "../utils";
import { Badge, Dot } from "./ui/badge";
import { Button } from "./ui/button";
import { Tooltip } from "./ui/tooltip";

/** Series colour per mail category. The same mapping is used in every chart and badge. */
export const CATEGORY_COLOR: Record<Category, { bg: string; fill: string }> = {
  invoice: { bg: "bg-chart-1", fill: "var(--accent)" },
  inquiry: { bg: "bg-chart-2", fill: "var(--chart-2)" },
  other: { bg: "bg-chart-3", fill: "var(--chart-3)" },
  suspicious: { bg: "bg-chart-4", fill: "var(--chart-4)" },
};

export function CategoryBadge({ category, className }: { category: Category; className?: string }) {
  return (
    <Badge tone="neutral" className={cn("bg-surface-2", className)}>
      <Dot className={CATEGORY_COLOR[category].bg} />
      {CATEGORY_LABEL[category]}
    </Badge>
  );
}

export function initials(name: string) {
  const words = name
    .replace(/[<>@].*$/, "")
    .split(/[\s.&+-]+/)
    .filter((w) => /^[A-Za-zÀ-ÿ]/.test(w));
  return ((words[0]?.[0] ?? "?") + (words[1]?.[0] ?? "")).toUpperCase();
}

/** One of five calm avatar tints, stable per sender: "Baustoffe Lenz" and "Baustoffe Lenz GmbH & Co. KG" get the same one. */
export function toneOf(name: string) {
  const key = name.toLowerCase().replace(/[^a-zà-ÿ\s]/g, " ").split(/\s+/).filter(Boolean).slice(0, 2).join(" ");
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return (h % 5) + 1;
}

const SIZE = { sm: 32, md: 38, lg: 44 } as const;

/** Trade icon for a company sender, so a supplier is recognised by its picture rather than its name. */
const TRADES: [RegExp, LucideIcon][] = [
  [/farben/i, PaintBucket],
  [/malerbedarf/i, Paintbrush],
  [/innung/i, Landmark],
  [/baustoff/i, BrickWall],
  [/gerüst/i, Construction],
  [/werkzeug/i, Hammer],
  [/entsorgung/i, Recycle],
  [/kfz|auto/i, Car],
  [/gmbh|kg\b|ag\b|partner|kanzlei|online/i, Building2],
];
export function tradeIcon(name: string): LucideIcon | null {
  return TRADES.find(([re]) => re.test(name))?.[1] ?? null;
}

/** Round avatar: initials for people, a trade icon for companies, in one of five calm tints. */
export function Avatar({ name, size = "md", className, icon }: { name: string; size?: keyof typeof SIZE; className?: string; icon?: LucideIcon | null }) {
  const tone = toneOf(name);
  const px = SIZE[size];
  const Icon = icon === undefined ? tradeIcon(name) : icon;
  return (
    <span
      aria-hidden
      className={cn("grid shrink-0 place-items-center rounded-full font-semibold tracking-[0.01em]", className)}
      style={{ width: px, height: px, fontSize: Math.round(px * 0.33), backgroundColor: `var(--avatar-${tone}-bg)`, color: `var(--avatar-${tone}-fg)` }}
    >
      {Icon ? <Icon style={{ width: px * 0.45, height: px * 0.45 }} strokeWidth={1.9} /> : initials(name)}
    </span>
  );
}

/** Avatar for a mail: a red shield when the assistant stopped it as suspicious, otherwise the sender. */
export function MailAvatar({ name, category, status, size = "md", className }: { name: string; category: Category; status: MailStatus; size?: keyof typeof SIZE; className?: string }) {
  if (category === "suspicious" || status === "quarantined") {
    const px = SIZE[size];
    return (
      <span aria-hidden className={cn("grid shrink-0 place-items-center rounded-full bg-bad-soft text-bad", className)} style={{ width: px, height: px }}>
        <ShieldAlert style={{ width: px * 0.45, height: px * 0.45 }} strokeWidth={1.9} />
      </span>
    );
  }
  return <Avatar name={name} size={size} className={className} />;
}

/** Overlapping avatars, e.g. the customers whose replies are waiting. */
export function AvatarStack({ names, max = 4, size = "md", ring = "ring-surface", className }: { names: string[]; max?: number; size?: keyof typeof SIZE; ring?: string; className?: string }) {
  const shown = names.slice(0, max);
  const rest = names.length - shown.length;
  const px = SIZE[size];
  return (
    <span className={cn("flex items-center", className)}>
      {shown.map((n, i) => (
        <motion.span
          key={`${n}-${i}`}
          initial={{ opacity: 0, scale: 0.6, x: -6 }}
          animate={{ opacity: 1, scale: 1, x: 0 }}
          transition={{ type: "spring", duration: 0.4, bounce: 0.3, delay: 0.15 + i * 0.05 }}
          className={cn("rounded-full ring-[3px]", ring, i > 0 && (size === "lg" ? "-ml-2" : "-ml-1.5"))}
        >
          <Avatar name={n} size={size} />
        </motion.span>
      ))}
      {rest > 0 && (
        <span
          className={cn("tnum grid shrink-0 place-items-center rounded-full bg-surface-2 text-[12.5px] font-semibold text-ink-2 ring-[3px]", size === "lg" ? "-ml-2" : "-ml-1.5", ring)}
          style={{ width: px, height: px }}
        >
          +{rest}
        </span>
      )}
    </span>
  );
}

const SEVERITY: Record<Finding["severity"], { icon: LucideIcon; className: string }> = {
  error: { icon: CircleAlert, className: "text-bad" },
  warning: { icon: TriangleAlert, className: "text-accent-text" },
  info: { icon: Info, className: "text-ink-3" },
};

export function Findings({ findings, empty, className }: { findings: Finding[]; empty?: ReactNode; className?: string }) {
  if (findings.length === 0) return <>{empty}</>;
  return (
    <ul className={cn("flex flex-col gap-2.5", className)}>
      {findings.map((f, i) => {
        const s = SEVERITY[f.severity];
        return (
          <motion.li
            key={`${f.code}-${i}`}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2, delay: i * 0.04 }}
            className="flex items-start gap-2.5 text-[13.5px] leading-snug text-ink"
          >
            <s.icon className={cn("mt-px size-4 shrink-0", s.className)} aria-hidden />
            <span>{f.message}</span>
          </motion.li>
        );
      })}
    </ul>
  );
}

export function AllGood({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-2.5 text-[13.5px] leading-snug text-ink">
      <CircleCheck className="mt-px size-4 shrink-0 text-good" aria-hidden />
      {children}
    </p>
  );
}

export function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex items-center justify-between gap-3 rounded-[18px] bg-bad-soft px-4 py-3 text-[13.5px] text-bad">
      <span className="flex items-center gap-2.5">
        <CircleAlert className="size-4 shrink-0" aria-hidden />
        {message}
      </span>
      {onRetry && (
        <Button size="sm" variant="ghost" className="text-bad hover:bg-bad/10 hover:text-bad" icon={<RefreshCw aria-hidden />} onClick={onRetry}>
          Erneut laden
        </Button>
      )}
    </div>
  );
}

/** Empty or finished state: icon in a soft circle, a short line, an optional next step. */
export function EmptyState({ icon: Icon, title, children, action, tone = "neutral", className }: { icon: LucideIcon; title: string; children?: ReactNode; action?: ReactNode; tone?: "neutral" | "good"; className?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24 }}
      className={cn("flex flex-col items-center px-6 py-12 text-center", className)}
    >
      <motion.span
        initial={{ scale: 0.7 }}
        animate={{ scale: 1 }}
        transition={{ type: "spring", duration: 0.45, bounce: 0.4 }}
        className={cn("grid size-16 place-items-center rounded-full", tone === "good" ? "bg-good-soft text-good" : "bg-surface-2 text-ink-2")}
      >
        <Icon className="size-7" strokeWidth={1.7} aria-hidden />
      </motion.span>
      <p className="mt-4 text-[16px] font-semibold text-ink">{title}</p>
      {children && <div className="mt-1.5 max-w-[320px] text-[13.5px] leading-relaxed text-ink-2">{children}</div>}
      {action && <div className="mt-5">{action}</div>}
    </motion.div>
  );
}

/** Internal link that uses the client router. */
/**
 * In-app link: changes the view without reloading the page. A Tooltip around it (Radix, asChild) hands in
 * its own onClick; it runs first and the navigation after it. Spreading it over ours made every link in a
 * tooltip (rail, corner arrows, logo) load the whole page again.
 */
export function Link({
  to,
  children,
  className,
  onClick,
  ...rest
}: {
  to: string;
  children: ReactNode;
  className?: string;
  "aria-label"?: string;
  "aria-current"?: "page" | "true";
  title?: string;
  onClick?: (e: MouseEvent<HTMLAnchorElement>) => void;
}) {
  return (
    <a
      href={to}
      className={className}
      {...rest}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        e.preventDefault();
        navigate(to);
      }}
    >
      {children}
    </a>
  );
}

/** Round arrow button in the corner of a card, links to the matching view. */
export function CornerLink({ to, label, tone = "default" }: { to: string; label: string; tone?: "default" | "hero" | "strong" }) {
  return (
    <Tooltip content={label} side="left">
      <Link
        to={to}
        aria-label={label}
        className={cn(
          "press group/corner grid size-10 shrink-0 place-items-center rounded-full",
          tone === "hero"
            ? "border border-white/15 text-hero-ink hover:bg-hero-2"
            : tone === "strong"
              ? "bg-accent-strong-ink text-[#111318] hover:bg-white/90"
              : "border border-line text-ink hover:bg-surface-2",
        )}
      >
        <ArrowUpRight className="size-[18px] transition-transform duration-200 group-hover/corner:translate-x-0.5 group-hover/corner:-translate-y-0.5" aria-hidden />
      </Link>
    </Tooltip>
  );
}
