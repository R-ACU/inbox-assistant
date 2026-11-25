import { Check } from "lucide-react";
import { DropdownMenu as M } from "radix-ui";
import type { ReactNode } from "react";
import { cn } from "../../utils";

/**
 * Menu on Radix DropdownMenu. Always non-modal: the modal variant injects an inline <style> to lock
 * scrolling, which the strict Content-Security-Policy would block.
 */
export function Menu({ trigger, children, align = "end", side = "bottom", label }: { trigger: ReactNode; children: ReactNode; align?: "start" | "end" | "center"; side?: "top" | "bottom" | "right"; label?: string }) {
  return (
    <M.Root modal={false}>
      <M.Trigger asChild>{trigger}</M.Trigger>
      <M.Portal>
        <M.Content
          align={align}
          side={side}
          sideOffset={8}
          aria-label={label}
          className="pop z-[70] flex min-w-[200px] flex-col gap-1 rounded-[18px] border border-line bg-surface p-1.5 shadow-pop"
        >
          {children}
        </M.Content>
      </M.Portal>
    </M.Root>
  );
}

const item =
  "press flex h-10 cursor-default items-center gap-2.5 rounded-[12px] px-3 text-[13.5px] text-ink outline-none select-none data-[highlighted]:bg-hover data-[disabled]:opacity-50 [&_svg]:size-4 [&_svg]:text-ink-3";

export function MenuItem({ children, onSelect, className, tone }: { children: ReactNode; onSelect?: () => void; className?: string; tone?: "bad" }) {
  return (
    <M.Item onSelect={onSelect} className={cn(item, tone === "bad" && "text-bad [&_svg]:text-bad", className)}>
      {children}
    </M.Item>
  );
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <M.Label className="px-2.5 pt-1.5 pb-1 text-[12px] text-ink-3">{children}</M.Label>;
}

export function MenuSeparator() {
  return <M.Separator className="mx-1 my-1.5 h-px bg-line" />;
}

export function MenuRadioGroup({ value, onValueChange, children }: { value: string; onValueChange: (v: string) => void; children: ReactNode }) {
  return (
    <M.RadioGroup value={value} onValueChange={onValueChange} className="flex flex-col gap-0.5">
      {children}
    </M.RadioGroup>
  );
}

export function MenuRadioItem({ value, children }: { value: string; children: ReactNode }) {
  return (
    <M.RadioItem value={value} className={cn(item, "justify-between")}>
      <span className="flex items-center gap-2.5">{children}</span>
      <M.ItemIndicator>
        <Check className="!text-accent-text" aria-hidden />
      </M.ItemIndicator>
    </M.RadioItem>
  );
}
