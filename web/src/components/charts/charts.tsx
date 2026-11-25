/**
 * Charts on Recharts in the shape language of the CRM: a stacked value is one continuous pill whose parts are
 * nested pills growing from the bottom (never separate dots on top of each other), the rest of the scale is a
 * hatched pill behind it, small pill bars and soft lines with a flat translucent area for key figures, a thick
 * half ring with round ends for a share, progress rings for list rows. Hover highlights the mark and fades the
 * rest, tooltip cards give the exact numbers, entry animations are short and off with reduced motion.
 */
import { motion } from "motion/react";
import { useId, useState, type ReactNode } from "react";
import { Area, AreaChart, Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis } from "recharts";
import { cn } from "../../utils";
import { usePrefersReducedMotion } from "../motion";
import { Tooltip } from "../ui/tooltip";

const ENTER_MS = 750;

// ---------------------------------------------------------------- shared

/** Diagonal hatching as an SVG pattern (a pattern, not a gradient). Rendered once per chart, referenced by id. */
function Hatch({ id, color }: { id: string; color: string }) {
  return (
    <svg width="0" height="0" aria-hidden className="absolute">
      <defs>
        <pattern id={id} patternUnits="userSpaceOnUse" width="7" height="7" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="7" stroke={color} strokeWidth="2.2" />
        </pattern>
      </defs>
    </svg>
  );
}

export interface TooltipRow {
  key: string;
  label: string;
  value: string;
  color: string;
  dim?: boolean;
}

export function TooltipCard({ title, rows, footer }: { title: ReactNode; rows: TooltipRow[]; footer?: { label: string; value: string } }) {
  return (
    <div className="animate-pop-in min-w-[190px] rounded-[18px] bg-surface px-4 py-3.5 text-ink shadow-pop">
      <p className="mb-2.5 text-[13px] font-medium text-ink">{title}</p>
      <ul className="flex flex-col gap-1.5">
        {rows.map((r) => (
          <li key={r.key} className={cn("flex items-center gap-2 text-[12.5px]", r.dim && "opacity-55")}>
            <span aria-hidden className="h-2 w-3.5 shrink-0 rounded-full" style={{ background: r.color }} />
            <span className="text-ink-2">{r.label}</span>
            <span className="tnum ml-auto pl-5 text-[13px] font-semibold text-ink">{r.value}</span>
          </li>
        ))}
      </ul>
      {footer && (
        <div className="mt-2 flex items-center gap-2 border-t border-line pt-2 text-[12.5px]">
          <span className="w-3.5 shrink-0" aria-hidden />
          <span className="text-ink-2">{footer.label}</span>
          <span className="tnum ml-auto pl-5 text-[13px] font-semibold text-ink">{footer.value}</span>
        </div>
      )}
    </div>
  );
}

/** Legend with the value of each series; the swatch is a small pill, like the marks. */
export function ValueLegend({ items, tone = "default", className }: { items: { key: string; label: string; value: string; color: string }[]; tone?: "default" | "hero"; className?: string }) {
  return (
    <ul className={cn("flex flex-wrap items-center gap-x-5 gap-y-1.5", className)}>
      {items.map((item) => (
        <li key={item.key} className="flex items-center gap-2 text-[13px]">
          <span className="h-2.5 w-4 rounded-full" style={{ backgroundColor: item.color }} aria-hidden />
          <span className={tone === "hero" ? "text-hero-ink-2" : "text-ink-2"}>{item.label}</span>
          <span className={cn("tnum font-semibold", tone === "hero" ? "text-hero-ink" : "text-ink")}>{item.value}</span>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------- stacked pill columns

export interface StackSeries {
  key: string;
  label: string;
  color: string;
}

interface PillShapeProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  index?: number;
  payload?: Record<string, number | string>;
}

/**
 * One pill per column for the total; the parts are nested pills growing from the bottom, the lowest series first
 * (as in the CRM's pipeline bars). A hatched pill behind each column shows the headroom to the peak.
 * Hovering a column fades the others and opens a card with every series and the total.
 * `tone="hero"` sets axis text and hatching for the dark hero card.
 */
export function StackedPills<Row extends { label: string; tooltipTitle: string } & Record<string, number | string>>({
  data,
  series,
  height = 260,
  ariaLabel,
  tone = "default",
  unit = (n: number) => String(n),
}: {
  data: Row[];
  /** Bottom to top. */
  series: StackSeries[];
  height?: number;
  ariaLabel: string;
  tone?: "default" | "hero";
  unit?: (n: number) => string;
}) {
  const reduced = usePrefersReducedMotion();
  const [active, setActive] = useState<number | null>(null);
  const hatchId = `hatch-${useId().replace(/:/g, "")}`;
  const rows = data.map((d) => ({ ...d, __total: series.reduce((s, x) => s + Number(d[x.key] ?? 0), 0) }));
  const max = Math.max(1, ...rows.map((r) => r.__total));
  const barSize = data.length <= 7 ? 46 : data.length <= 10 ? 36 : 26;
  const tick = { fill: tone === "hero" ? "var(--hero-ink-2)" : "var(--ink-3)", fontSize: 12 };

  const Pill = (props: PillShapeProps) => {
    const { x = 0, y = 0, width = 0, height: h = 0, index = 0, payload } = props;
    if (!(width > 0) || !(h > 0) || !payload) return <g />;
    const total = Number(payload.__total ?? 0);
    const r = width / 2;
    // Cumulative heights from the bottom: the pill for series k covers series 0..k.
    let cum = 0;
    const pills = series.map((s) => {
      cum += Number(payload[s.key] ?? 0);
      return { key: s.key, color: s.color, h: total > 0 ? (h * cum) / total : 0, value: Number(payload[s.key] ?? 0) };
    });
    return (
      <g style={{ opacity: active === null || active === index ? 1 : 0.4, transition: "opacity 180ms cubic-bezier(0.23,1,0.32,1)" }}>
        {[...pills].reverse().map((p) =>
          p.value > 0 || p.h === h ? <rect key={p.key} x={x} y={y + h - p.h} width={width} height={p.h} rx={Math.min(r, p.h / 2)} fill={p.color} /> : null,
        )}
      </g>
    );
  };

  const Track = (props: PillShapeProps) => {
    const { x = 0, y = 0, width = 0, height: h = 0, index = 0 } = props;
    return (
      <rect
        x={x}
        y={y}
        width={width}
        height={h}
        rx={width / 2}
        fill={`url(#${hatchId})`}
        opacity={active !== null && active !== index ? 0.5 : 1}
        style={{ transition: "opacity 180ms cubic-bezier(0.23,1,0.32,1)" }}
      />
    );
  };

  return (
    <div role="img" aria-label={ariaLabel} style={{ height }} className="relative w-full">
      <Hatch id={hatchId} color={tone === "hero" ? "var(--hero-hatch)" : "var(--hatch)"} />
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={rows}
          margin={{ top: 4, right: 0, bottom: 0, left: 0 }}
          barCategoryGap="22%"
          onMouseMove={(s) => setActive(s.isTooltipActive && s.activeTooltipIndex != null ? Number(s.activeTooltipIndex) : null)}
          onMouseLeave={() => setActive(null)}
        >
          <XAxis dataKey="label" tickLine={false} axisLine={false} tick={tick} tickMargin={12} interval={data.length > 10 ? 1 : 0} height={34} />
          <YAxis hide domain={[0, max]} allowDecimals={false} />
          <ChartTooltip
            cursor={false}
            isAnimationActive={false}
            wrapperStyle={{ outline: "none", zIndex: 20 }}
            offset={18}
            content={({ active: on, payload }) => {
              if (!on || !payload?.length) return null;
              const row = payload[0]!.payload as Row & { __total: number };
              return (
                <TooltipCard
                  title={row.tooltipTitle}
                  rows={[...series].reverse().map((s) => ({ key: s.key, label: s.label, value: unit(Number(row[s.key] ?? 0)), color: s.color, dim: Number(row[s.key] ?? 0) === 0 }))}
                  footer={{ label: "Zusammen", value: unit(row.__total) }}
                />
              );
            }}
          />
          <Bar
            dataKey="__total"
            maxBarSize={barSize}
            minPointSize={0}
            isAnimationActive={!reduced}
            animationDuration={ENTER_MS}
            animationEasing="ease-out"
            shape={Pill as never}
            background={Track as never}
            activeBar={false}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---------------------------------------------------------------- spark bars and spark line

export interface SparkPoint {
  label: string;
  value: number;
}

function SparkTip({ format }: { format: (v: number) => string }) {
  return (
    <ChartTooltip
      cursor={false}
      isAnimationActive={false}
      wrapperStyle={{ outline: "none", zIndex: 20 }}
      allowEscapeViewBox={{ x: true, y: true }}
      offset={14}
      position={{ y: -52 }}
      content={({ active, payload }) => {
        const point = active && payload?.[0] ? (payload[0].payload as SparkPoint) : null;
        if (!point) return null;
        return (
          <div className="animate-pop-in rounded-[12px] bg-surface px-3 py-2 whitespace-nowrap text-ink shadow-pop">
            <p className="text-[11.5px] text-ink-3">{point.label}</p>
            <p className="tnum text-[13px] font-semibold">{format(point.value)}</p>
          </div>
        );
      }}
    />
  );
}

/** Small pill bars in full-height quiet tracks; the latest day with a value and the hovered one in the accent. */
export function SparkBars({ points, format, ariaLabel, height = 56 }: { points: SparkPoint[]; format: (v: number) => string; ariaLabel: string; height?: number }) {
  const reduced = usePrefersReducedMotion();
  const [active, setActive] = useState<number | null>(null);
  const lastWithValue = points.reduce((last, p, i) => (p.value > 0 ? i : last), -1);
  const max = Math.max(1, ...points.map((p) => p.value));
  const rows = points.map((p) => ({ ...p, __max: max }));
  const Shape = (props: PillShapeProps) => {
    const { x = 0, y = 0, width = 0, height: h = 0, index = 0, payload } = props;
    if (!(width > 0) || !(h > 0) || !payload) return <g />;
    const value = Number(payload.value ?? 0);
    const vh = value > 0 ? Math.max(width, (h * value) / max) : 0;
    const on = index === active || (active === null && index === lastWithValue);
    return (
      <g>
        <rect x={x} y={y} width={width} height={h} rx={width / 2} fill="var(--surface-2)" />
        {vh > 0 && <rect x={x} y={y + h - vh} width={width} height={vh} rx={width / 2} fill={on ? "var(--accent)" : "var(--chart-2)"} style={{ transition: "fill 160ms ease-out" }} />}
      </g>
    );
  };
  return (
    <div role="img" aria-label={ariaLabel} style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={rows}
          margin={{ top: 2, right: 0, bottom: 0, left: 0 }}
          barCategoryGap="22%"
          onMouseMove={(s) => setActive(s.isTooltipActive && s.activeTooltipIndex != null ? Number(s.activeTooltipIndex) : null)}
          onMouseLeave={() => setActive(null)}
        >
          <YAxis hide domain={[0, (m: number) => Math.max(1, m)]} />
          <SparkTip format={format} />
          <Bar dataKey="__max" maxBarSize={16} shape={Shape as never} activeBar={false} isAnimationActive={!reduced} animationDuration={ENTER_MS} animationEasing="ease-out" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** A soft line with a flat, translucent area. On the strong accent card it is drawn in white. */
export function SparkArea({ points, format, ariaLabel, height = 56, onStrong = false }: { points: SparkPoint[]; format: (v: number) => string; ariaLabel: string; height?: number; onStrong?: boolean }) {
  const reduced = usePrefersReducedMotion();
  const stroke = onStrong ? "#ffffff" : "var(--accent)";
  return (
    <div role="img" aria-label={ariaLabel} style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 6, right: 6, bottom: 4, left: 6 }}>
          <YAxis hide domain={[0, (m: number) => Math.max(1, m * 1.1)]} />
          <XAxis dataKey="label" hide />
          <SparkTip format={format} />
          <Area
            type="monotone"
            dataKey="value"
            stroke={stroke}
            strokeWidth={2.5}
            fill={stroke}
            fillOpacity={onStrong ? 0.16 : 0.1}
            dot={false}
            activeDot={{ r: 5.5, fill: stroke, stroke: onStrong ? "var(--accent-strong)" : "var(--surface)", strokeWidth: 3 }}
            isAnimationActive={!reduced}
            animationDuration={ENTER_MS}
            animationEasing="ease-out"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---------------------------------------------------------------- half gauge

export interface GaugePart {
  key: string;
  label: string;
  value: number;
}

/** A thick half ring with round ends: the first part in the accent, the rest hatched. Hovering a part shows it in the middle. */
export function HalfGauge({ parts, center, ariaLabel, width = 280 }: { parts: [GaugePart, GaugePart]; center: (hovered: GaugePart | null) => ReactNode; ariaLabel: string; width?: number }) {
  const reduced = usePrefersReducedMotion();
  const hatchId = `gauge-${useId().replace(/:/g, "")}`;
  const [hovered, setHovered] = useState<number | null>(null);
  const total = parts[0].value + parts[1].value;
  const data = total === 0 ? [{ key: "none", label: "", value: 1 }] : parts.filter((p) => p.value > 0);
  const h = Math.round(width * 0.53);
  const outer = width / 2 - 2;
  const inner = outer - Math.round(width * 0.13);
  return (
    <div role="img" aria-label={ariaLabel} className="relative mx-auto" style={{ width, height: h }}>
      <Hatch id={hatchId} color="var(--hatch)" />
      <PieChart width={width} height={h}>
        <Pie
          data={data}
          dataKey="value"
          cx={width / 2}
          cy={h - 4}
          innerRadius={inner}
          outerRadius={outer}
          startAngle={180}
          endAngle={0}
          paddingAngle={data.length > 1 ? 4 : 0}
          cornerRadius={999}
          stroke="none"
          isAnimationActive={!reduced}
          animationDuration={900}
          animationEasing="ease-out"
          onMouseEnter={(_, i) => total > 0 && setHovered(i)}
          onMouseLeave={() => setHovered(null)}
        >
          {data.map((p) => (
            <Cell
              key={p.key}
              fill={p.key === parts[0].key ? "var(--accent)" : `url(#${hatchId})`}
              fillOpacity={hovered === null || data[hovered]?.key === p.key ? 1 : 0.35}
              style={{ transition: "fill-opacity 180ms ease-out", outline: "none" }}
            />
          ))}
        </Pie>
      </PieChart>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col items-center text-center">{center(hovered === null || total === 0 ? null : ((data[hovered] as GaugePart) ?? null))}</div>
    </div>
  );
}

// ---------------------------------------------------------------- progress ring

/** Small ring with the share in the middle, for list rows (supplier share, check result). */
export function Ring({ value, size = 40, label, tone = "accent" }: { value: number; size?: number; label: string; tone?: "accent" | "bad" | "good" }) {
  const reduced = usePrefersReducedMotion();
  const stroke = 3.5;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(1, value));
  const color = tone === "bad" ? "var(--bad)" : tone === "good" ? "var(--good)" : "var(--accent)";
  return (
    <span role="img" aria-label={label} className="relative grid shrink-0 place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--track)" strokeWidth={stroke} />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: reduced ? c * (1 - pct) : c }}
          animate={{ strokeDashoffset: c * (1 - pct) }}
          transition={{ duration: 0.8, ease: [0.23, 1, 0.32, 1], delay: 0.15 }}
        />
      </svg>
      <span aria-hidden className="tnum absolute text-[10.5px] font-semibold text-ink">
        {Math.round(pct * 100)}%
      </span>
    </span>
  );
}

// ---------------------------------------------------------------- split bar

export interface PillSlice {
  key: string;
  label: string;
  value: number;
  color: string;
}

/**
 * A whole split into its parts as one continuous bar: nested pills growing from the left, like the stacked
 * columns. Hover on a part or its legend item highlights it. `legend={false}` hides the legend.
 */
export function SplitBar({ slices, ariaLabel, legend = true, format = (n: number) => String(n), height = 14, tone = "default" }: { slices: PillSlice[]; ariaLabel: string; legend?: boolean; format?: (n: number) => string; height?: number; tone?: "default" | "hero" }) {
  const reduced = usePrefersReducedMotion();
  const [hover, setHover] = useState<string | null>(null);
  const total = slices.reduce((s, x) => s + x.value, 0);
  let cum = 0;
  const parts = slices.map((s) => {
    cum += s.value;
    return { ...s, upto: total === 0 ? 0 : cum / total };
  });
  return (
    <div>
      <div role="img" aria-label={ariaLabel} className={cn("relative w-full overflow-hidden rounded-full", tone === "hero" ? "bg-hero-2" : "bg-track")} style={{ height }}>
        {[...parts].reverse().map((p, i) =>
          p.value > 0 ? (
            <Tooltip key={p.key} content={`${p.label}: ${format(p.value)}`}>
              <motion.div
                className="absolute inset-y-0 left-0 cursor-default rounded-full"
                style={{ background: p.color }}
                initial={reduced ? false : { width: 0 }}
                animate={{ width: `${p.upto * 100}%`, opacity: hover && hover !== p.key ? 0.45 : 1 }}
                transition={{ width: { duration: 0.8, delay: 0.1 + (parts.length - 1 - i) * 0.05, ease: [0.23, 1, 0.32, 1] }, opacity: { duration: 0.18 } }}
                onMouseEnter={() => setHover(p.key)}
                onMouseLeave={() => setHover(null)}
              />
            </Tooltip>
          ) : null,
        )}
      </div>
      {legend && (
        <ul className="mt-4 grid grid-cols-2 gap-x-3 gap-y-1">
          {slices.map((s) => (
            <li key={s.key} className="min-w-0">
              <button
                type="button"
                onMouseEnter={() => setHover(s.key)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(s.key)}
                onBlur={() => setHover(null)}
                className={cn(
                  "press flex w-full items-center justify-between gap-2 rounded-full px-2.5 py-1.5 text-left text-[13px]",
                  tone === "hero" ? "hover:bg-hero-2" : "hover:bg-surface-2",
                  hover === s.key && (tone === "hero" ? "bg-hero-2" : "bg-surface-2"),
                )}
              >
                <span className={cn("flex min-w-0 items-center gap-2", tone === "hero" ? "text-hero-ink-2" : "text-ink-2")}>
                  <span aria-hidden className="h-2.5 w-4 shrink-0 rounded-full" style={{ background: s.color }} />
                  <span className="truncate">{s.label}</span>
                </span>
                <span className={cn("tnum shrink-0 font-semibold", tone === "hero" ? "text-hero-ink" : "text-ink")}>{format(s.value)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
