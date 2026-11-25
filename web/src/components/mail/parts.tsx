/** Pieces shared by the mailbox list and the reading pane. */
import { useSyncExternalStore } from "react";
import type { MailStatus } from "../../../../src/shared/types";
import { STATUS_LABEL } from "../../lib";
import { cn } from "../../utils";
import { Badge } from "../ui/badge";
import { Skeleton } from "../ui/misc";
import { Panel } from "./workspace";

export function useMediaQuery(query: string) {
  return useSyncExternalStore(
    (fn) => {
      const m = window.matchMedia(query);
      m.addEventListener("change", fn);
      return () => m.removeEventListener("change", fn);
    },
    () => window.matchMedia(query).matches,
  );
}

/** Wide enough for list, reading pane and a separate action column side by side. */
export const useWide = () => useMediaQuery("(min-width: 1280px)");

const STATUS_TONE: Record<MailStatus, "neutral" | "accent" | "good" | "bad" | "outline"> = {
  awaiting_approval: "accent",
  needs_review: "accent",
  quarantined: "bad",
  filed: "neutral",
  approved: "neutral",
  delivery_failed: "bad",
  sent: "good",
  discarded: "neutral",
  resolved: "neutral",
};

/** Short status words for list chips; the full label is in the reading pane. */
export const STATUS_SHORT: Partial<Record<MailStatus, string>> = {
  awaiting_approval: "Freigabe",
  needs_review: "Prüfen",
  quarantined: "Quarantäne",
  delivery_failed: "Fehler",
};

export function StatusBadge({ status, short = false, className }: { status: MailStatus; short?: boolean; className?: string }) {
  return (
    <Badge tone={STATUS_TONE[status]} className={className}>
      {short ? (STATUS_SHORT[status] ?? STATUS_LABEL[status]) : STATUS_LABEL[status]}
    </Badge>
  );
}

export function ListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div aria-busy="true" aria-label="Wird geladen" className="flex flex-col gap-1 px-1">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-[20px] px-2 py-3" aria-hidden>
          <Skeleton className="size-[38px] rounded-full" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-3.5 w-1/2" />
            <Skeleton className="h-3 w-4/5" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ReaderSkeleton({ className }: { className?: string }) {
  return (
    <Panel className={cn("flex-1", className)}>
      <div aria-busy="true" aria-label="Wird geladen" className="flex flex-col gap-4 p-8">
        <Skeleton className="h-8 w-2/3" />
        <div className="flex items-center gap-3">
          <Skeleton className="size-11 rounded-full" />
          <Skeleton className="h-4 w-48" />
        </div>
        <Skeleton className="mt-4 h-28 w-full rounded-[22px]" />
        <Skeleton className="h-56 w-full rounded-[22px]" />
      </div>
    </Panel>
  );
}
