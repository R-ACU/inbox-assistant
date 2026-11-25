/**
 * Shared motion settings. Short and springy, never slow: UI transitions stay between 150 and 300 ms.
 * MotionConfig in App honours prefers-reduced-motion for every motion component; the helpers here
 * do the same for things motion does not drive (counters, Recharts).
 */
import { animate, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";

/** Selection pills and sliding marks. Settles in about 250 ms with a hint of bounce. */
export const spring = { type: "spring", duration: 0.32, bounce: 0.18 } as const;
/** Things that move a little further, like rows leaving a list. */
export const springSoft = { type: "spring", duration: 0.4, bounce: 0.08 } as const;
export const easeOut = [0.23, 1, 0.32, 1] as const;
export const fade = { duration: 0.18, ease: easeOut } as const;

export function usePrefersReducedMotion(): boolean {
  return useReducedMotion() ?? false;
}

/**
 * What every counter last aimed at, by id, for as long as the page is open. A number counts up from 0 only
 * the first time it appears. When it shows again (a hover swapped it out and back, the period or week
 * changed and the card was rebuilt, the user came back to the page) it starts at the value it already
 * reached: an unchanged number stands still, a changed one moves from the old value to the new one.
 */
const reached = new Map<string, number>();

/** Counts to `value` (see `reached` for where it starts). Jumps straight there with reduced motion. */
export function useCountUp(id: string, value: number, duration = 0.9): number {
  const reduced = usePrefersReducedMotion();
  const start = reduced ? value : (reached.get(id) ?? 0);
  const [shown, setShown] = useState(start);
  const current = useRef(start);
  useEffect(() => {
    reached.set(id, value);
    if (reduced || current.current === value) {
      current.current = value;
      setShown(value);
      return;
    }
    const controls = animate(current.current, value, {
      duration,
      ease: easeOut,
      onUpdate: (v) => {
        current.current = v;
        setShown(v);
      },
    });
    return () => controls.stop();
  }, [id, value, duration, reduced]);
  return shown;
}

/** A number that counts up once. `id` names it for the whole app (for example "overview.mails"), so it never counts twice. */
export function CountUp({ id, value, format = (v) => Math.round(v).toLocaleString("de-DE"), duration }: { id: string; value: number; format?: (v: number) => string; duration?: number }) {
  const shown = useCountUp(id, value, duration);
  return (
    <span className="tnum">
      <span className="sr-only">{format(value)}</span>
      <span aria-hidden>{format(shown)}</span>
    </span>
  );
}
