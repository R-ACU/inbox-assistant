import { forwardRef, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react";
import { cn } from "../../utils";

const field =
  "w-full rounded-[14px] border border-line-strong bg-surface text-ink outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-ink-3 hover:border-ink-3/60 focus:border-accent focus:shadow-[0_0_0_3px_var(--accent-soft)] focus-visible:outline-none";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...props }, ref) {
  return <input ref={ref} className={cn(field, "h-11 px-4 text-[14px]", className)} {...props} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...props }, ref) {
  return <textarea ref={ref} className={cn(field, "px-4 py-3.5 text-[14px] leading-[1.65]", className)} {...props} />;
});

export function Label({ htmlFor, children, className }: { htmlFor: string; children: ReactNode; className?: string }) {
  return (
    <label htmlFor={htmlFor} className={cn("mb-1.5 block text-[13px] font-medium text-ink-2", className)}>
      {children}
    </label>
  );
}
