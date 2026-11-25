import { CircleCheck, Info } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";

type Tone = "done" | "info";
interface Toast {
  id: number;
  text: string;
  tone: Tone;
}

const ToastContext = createContext<(text: string, tone?: Tone) => void>(() => {});
export const useToast = () => useContext(ToastContext);

/** Short confirmations at the bottom centre. They rise in, stack and leave on their own after four seconds. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(1);
  const push = useCallback((text: string, tone: Tone = "done") => {
    const id = next.current++;
    setToasts((t) => [...t.slice(-2), { id, text, tone }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-6 z-[95] flex flex-col items-center gap-2 px-4 max-lg:bottom-24">
        <AnimatePresence initial={false}>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              layout
              role="status"
              initial={{ opacity: 0, y: 16, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.97 }}
              transition={{ type: "spring", duration: 0.32, bounce: 0.16 }}
              className="pointer-events-auto flex items-center gap-2.5 rounded-full bg-[#18181b] py-2.5 pr-5 pl-3.5 text-[13.5px] font-medium text-white shadow-pop dark:bg-[#f4f4f5] dark:text-[#111318]"
            >
              {t.tone === "done" ? <CircleCheck className="size-[18px] text-[#5ee39a] dark:text-good" aria-hidden /> : <Info className="size-[18px] opacity-70" aria-hidden />}
              {t.text}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}
