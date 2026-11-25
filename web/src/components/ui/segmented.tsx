import { LayoutGroup, motion } from "motion/react";
import { useId, type KeyboardEvent } from "react";
import { cn } from "../../utils";
import { spring } from "../motion";

/**
 * Pill-shaped switch between a few options, as in the CRM: a quiet track, the chosen option on a light thumb
 * that slides over (in dark mode a slightly lighter surface, never white). Optional counts sit next to the labels.
 * `fill` stretches the options over the full width.
 */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  className,
  fill = false,
  role = "radiogroup",
}: {
  value: T;
  options: { value: T; label: string; count?: number }[];
  onChange: (v: T) => void;
  label: string;
  className?: string;
  fill?: boolean;
  /** "tablist" when the options switch what a list shows. */
  role?: "radiogroup" | "tablist";
}) {
  const id = useId();
  const itemRole = role === "tablist" ? "tab" : "radio";
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const i = options.findIndex((o) => o.value === value);
    const next = options[(i + (e.key === "ArrowRight" ? 1 : options.length - 1)) % options.length]!;
    onChange(next.value);
    (e.currentTarget.querySelector(`[data-value="${next.value}"]`) as HTMLElement | null)?.focus();
  };
  return (
    <LayoutGroup id={id}>
      <div role={role} aria-label={label} onKeyDown={onKey} className={cn("inline-flex h-11 items-center gap-1 rounded-full bg-track p-1", fill && "flex w-full", className)}>
        {options.map((o) => {
          const active = o.value === value;
          return (
            <button
              key={o.value}
              type="button"
              role={itemRole}
              aria-checked={itemRole === "radio" ? active : undefined}
              aria-selected={itemRole === "tab" ? active : undefined}
              tabIndex={active ? 0 : -1}
              data-value={o.value}
              onClick={() => onChange(o.value)}
              className={cn(
                "press relative flex h-9 items-center justify-center gap-1.5 rounded-full px-4 text-[13px] font-medium whitespace-nowrap transition-colors duration-200",
                fill && "flex-1 px-2",
                active ? "text-ink" : "text-ink-2 hover:text-ink",
              )}
            >
              {active && <motion.span layoutId="segment" transition={spring} className="absolute inset-0 rounded-full bg-thumb shadow-[0_1px_2px_rgb(16_24_40/0.08),0_1px_6px_-2px_rgb(16_24_40/0.1)]" />}
              <span className="relative">{o.label}</span>
              {o.count !== undefined && <span className={cn("tnum relative text-[12px]", active ? "text-ink-2" : "text-ink-3")}>{o.count}</span>}
            </button>
          );
        })}
      </div>
    </LayoutGroup>
  );
}
