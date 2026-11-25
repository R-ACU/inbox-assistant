import { Tooltip as T } from "radix-ui";
import type { ReactNode } from "react";
import { cn } from "../../utils";

export const TooltipProvider = ({ children }: { children: ReactNode }) => (
  <T.Provider delayDuration={350} skipDelayDuration={250}>
    {children}
  </T.Provider>
);

/** Small dark label next to the trigger. The first one waits a moment, the next ones open at once. */
export function Tooltip({
  content,
  children,
  side = "top",
  align = "center",
  className,
}: {
  content: ReactNode;
  children: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  className?: string;
}) {
  return (
    <T.Root>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content
          side={side}
          align={align}
          sideOffset={8}
          className={cn(
            "pop z-[80] flex items-center gap-2 rounded-[12px] bg-[#18181b] px-2.5 py-1.5 text-[12.5px] font-medium text-white shadow-pop dark:bg-[#f4f4f5] dark:text-[#111318]",
            className,
          )}
        >
          {content}
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}
