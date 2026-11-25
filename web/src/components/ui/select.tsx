/**
 * Own dropdown (button plus listbox) instead of a native <select>, whose open list cannot be styled on Windows.
 * Keyboard: Enter, Space or ArrowDown opens; arrows, Home and End move; Enter selects; Escape and a click outside close.
 * Opens and closes with a short scale and fade from the top edge.
 */
import { Check, ChevronDown } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { t } from "../../i18n";
import { cn } from "../../utils";

export interface Option<T extends string> {
  value: T;
  label: string;
  hint?: string;
  icon?: ReactNode;
}

export function Select<T extends string>({
  label,
  value,
  options,
  onChange,
  className,
  variant = "field",
}: {
  label: string;
  value: T;
  options: Option<T>[];
  onChange: (value: T) => void;
  className?: string;
  /** "pill": compact, borderless trigger for filters; the list opens to the right edge. */
  variant?: "field" | "pill";
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const id = useId();
  const current: Option<T> | undefined = options.find((o) => o.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
    const onDoc = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    requestAnimationFrame(() => list.current?.focus({ preventScroll: true }));
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open, options, value]);

  const close = (focus = true) => {
    setOpen(false);
    if (focus) button.current?.focus();
  };

  const choose = (i: number) => {
    const option = options[i];
    if (!option) return;
    onChange(option.value);
    close();
  };

  const onListKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown") setActive((a) => Math.min(options.length - 1, a + 1));
    else if (e.key === "ArrowUp") setActive((a) => Math.max(0, a - 1));
    else if (e.key === "Home") setActive(0);
    else if (e.key === "End") setActive(options.length - 1);
    else if (e.key === "Enter" || e.key === " ") choose(active);
    else if (e.key === "Escape") {
      e.stopPropagation();
      close();
    } else if (e.key === "Tab") {
      close(false);
      return;
    } else return;
    e.preventDefault();
  };

  return (
    <div ref={root} className={cn("relative", className)} onKeyDown={open ? onListKey : undefined}>
      <button
        ref={button}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${label}: ${current?.label ?? "keine Auswahl"}`}
        disabled={!current}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (!open && (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className={cn(
          "press flex items-center gap-2.5 rounded-full text-left text-ink disabled:text-ink-3",
          variant === "pill"
            ? "h-9 bg-surface-2 pr-3 pl-3.5 text-[13px] font-medium hover:bg-hover"
            : "h-10 w-full border border-line-strong bg-surface px-4 text-[13.5px] hover:border-ink-3/60",
        )}
      >
        {current?.icon}
        <span className="min-w-0 flex-1 truncate">{current?.label ?? t("Wird geladen", "Loading")}</span>
        <ChevronDown className={cn("size-4 shrink-0 text-ink-3 transition-transform duration-200", open && "rotate-180")} aria-hidden />
      </button>
      <AnimatePresence>
        {open && (
          <motion.ul
            ref={list}
            id={id}
            role="listbox"
            tabIndex={-1}
            aria-label={label}
            aria-activedescendant={`${id}-${active}`}
            initial={{ opacity: 0, scale: 0.97, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: -2, transition: { duration: 0.12 } }}
            transition={{ type: "spring", duration: 0.24, bounce: 0.1 }}
            className={cn(
              "absolute z-40 mt-1.5 flex min-w-[220px] flex-col gap-1 rounded-[18px] border border-line bg-surface p-1.5 shadow-pop outline-none",
              variant === "pill" ? "right-0 origin-top-right" : "right-0 left-0 origin-top",
            )}
          >
            {options.map((o, i) => (
              <li
                key={o.value}
                id={`${id}-${i}`}
                role="option"
                aria-selected={o.value === value}
                data-value={o.value}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(i)}
                className={cn(
                  "flex min-h-[40px] cursor-pointer items-center gap-2.5 rounded-[12px] px-3 py-2 text-[13.5px] transition-colors duration-100",
                  i === active ? "bg-hover text-ink" : "text-ink-2",
                )}
              >
                {o.icon}
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{o.label}</span>
                  {o.hint && <span className="block truncate text-[12px] text-ink-3">{o.hint}</span>}
                </span>
                {o.value === value && <Check className="size-4 shrink-0 text-accent-text" aria-hidden />}
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}
