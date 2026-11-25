import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "../../utils";

export const badgeVariants = cva("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full font-medium [&_svg]:size-3.5 [&_svg]:shrink-0", {
  variants: {
    tone: {
      neutral: "bg-hover text-ink-2",
      accent: "bg-accent-soft text-accent-text",
      good: "bg-good-soft text-good",
      bad: "bg-bad-soft text-bad",
      outline: "border border-line text-ink-2",
    },
    size: {
      sm: "h-6 px-2 text-[12px]",
      md: "h-7 px-2.5 text-[12.5px]",
    },
  },
  defaultVariants: { tone: "neutral", size: "sm" },
});

export function Badge({ className, tone, size, ...props }: HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone, size }), className)} {...props} />;
}

/** A small round dot in a series or status colour, always next to a text label. */
export function Dot({ className }: { className?: string }) {
  return <span aria-hidden className={cn("inline-block size-2 shrink-0 rounded-full", className)} />;
}
