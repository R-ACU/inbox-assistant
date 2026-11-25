import { X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { t } from "../../i18n";
import { easeOut } from "../motion";
import { Button } from "./button";

/**
 * Modal dialog. Built on motion instead of Radix Dialog: Radix locks scrolling with an inline <style>,
 * which the strict Content-Security-Policy blocks. Focus stays inside, Escape and a click outside close it,
 * and the focus returns to where it was.
 */
export function Dialog({ open, onClose, title, children, width = 460 }: { open: boolean; onClose: () => void; title: string; children: ReactNode; width?: number }) {
  return createPortal(
    <AnimatePresence>{open && <DialogPanel onClose={onClose} title={title} width={width}>{children}</DialogPanel>}</AnimatePresence>,
    document.body,
  );
}

function DialogPanel({ onClose, title, children, width }: { onClose: () => void; title: string; children: ReactNode; width: number }) {
  const id = useId();
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLElement>("button, [href], input, textarea")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
      if (e.key === "Tab" && panel.current) {
        const items = [...panel.current.querySelectorAll<HTMLElement>("button, [href], input, textarea")].filter((el) => !el.hasAttribute("disabled"));
        const first = items[0];
        const last = items.at(-1);
        if (!first || !last) return;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      previous?.focus();
    };
  }, [onClose]);

  return (
    <motion.div
      className="fixed inset-0 z-[90] grid place-items-center bg-[#0b0b0c]/45 px-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18, ease: easeOut }}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <motion.div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        className="w-full rounded-[28px] bg-surface p-7 shadow-pop"
        style={{ maxWidth: width }}
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 4 }}
        transition={{ type: "spring", duration: 0.3, bounce: 0.12 }}
      >
        <div className="mb-5 flex items-center justify-between gap-4">
          <h2 id={id} className="text-[17px] font-semibold text-ink">
            {title}
          </h2>
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label={t("Schließen", "Close")} icon={<X aria-hidden />} />
        </div>
        {children}
      </motion.div>
    </motion.div>
  );
}
