import type { ReactNode } from "react";
import { cn } from "../../utils";

/** Grey placeholder in the shape of what is loading. Pulses gently. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("animate-shimmer rounded-lg bg-hover", className)} />;
}

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        "tnum inline-grid h-6 min-w-6 place-items-center rounded-[8px] border border-line-strong bg-surface px-1.5 text-[12px] font-semibold text-ink shadow-[0_1px_0_var(--line-strong)]",
        className,
      )}
    >
      {children}
    </kbd>
  );
}
