import type { LucideIcon } from "lucide-react";
import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "../../utils";

/** Surface with a fine line and a soft shadow. `interactive` lifts it slightly on hover. */
export function Card({ className, interactive = false, ...props }: HTMLAttributes<HTMLDivElement> & { interactive?: boolean }) {
  return (
    <div
      className={cn(
        "rounded-[28px] bg-surface shadow-card",
        interactive &&
          "transition-[box-shadow,transform] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] hover:-translate-y-0.5 hover:shadow-lift motion-reduce:hover:translate-y-0",
        className,
      )}
      {...props}
    />
  );
}

/** Inner card inside a card ("card in card"): a softer surface with its own rounding. */
export function InnerCard({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-[22px] bg-surface-2", className)} {...props} />;
}

/** Round icon next to a title. `tone="solid"` fills it with the accent. */
export function IconCircle({ icon: Icon, tone = "soft", size = 44, className }: { icon: LucideIcon; tone?: "soft" | "solid" | "plain"; size?: number; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid shrink-0 place-items-center rounded-full",
        tone === "solid" ? "bg-accent text-accent-ink" : tone === "plain" ? "bg-surface text-ink shadow-card" : "bg-accent-soft text-accent-text",
        className,
      )}
      style={{ width: size, height: size }}
    >
      <Icon className="size-[44%]" strokeWidth={1.9} />
    </span>
  );
}

export function CardHeader({ title, description, aside, className, id, icon }: { title: ReactNode; description?: ReactNode; aside?: ReactNode; className?: string; id?: string; icon?: LucideIcon }) {
  return (
    <div className={cn("flex items-start justify-between gap-4", className)}>
      <div className="flex min-w-0 items-center gap-3.5">
        {icon && <IconCircle icon={icon} />}
        <div className="min-w-0">
          <h2 id={id} className="text-[17px] leading-tight font-medium tracking-[-0.01em] text-ink">
            {title}
          </h2>
          {description && <p className="mt-1 text-[13px] leading-relaxed text-ink-3">{description}</p>}
        </div>
      </div>
      {aside && <div className="flex shrink-0 items-center gap-2">{aside}</div>}
    </div>
  );
}
