import { cva, type VariantProps } from "class-variance-authority";
import { LoaderCircle } from "lucide-react";
import { Slot } from "radix-ui";
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "../../utils";

export const buttonVariants = cva(
  "press inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-full font-medium select-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-accent text-accent-ink shadow-[0_1px_2px_rgb(16_24_40/0.12)] hover:bg-accent-hover",
        secondary: "bg-surface-2 text-ink hover:bg-hover",
        outline: "border border-line-strong bg-surface text-ink hover:bg-surface-2",
        ghost: "text-ink-2 hover:bg-hover hover:text-ink",
        soft: "bg-accent-soft text-accent-text hover:brightness-[0.97] dark:hover:brightness-125",
        danger: "bg-bad text-white hover:brightness-95 dark:text-[#1a0605]",
        "danger-ghost": "text-bad hover:bg-bad-soft",
      },
      size: {
        sm: "h-8 px-3.5 text-[13px] [&_svg]:size-4",
        md: "h-10 px-4 text-[13.5px] [&_svg]:size-4",
        lg: "h-12 px-6 text-[14.5px] [&_svg]:size-[18px]",
        icon: "size-10 [&_svg]:size-[18px]",
        "icon-sm": "size-9 [&_svg]:size-4",
      },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  busy?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, asChild = false, busy = false, icon, children, disabled, type, ...props },
  ref,
) {
  if (asChild) {
    return (
      <Slot.Root ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props}>
        {children}
      </Slot.Root>
    );
  }
  return (
    <button
      ref={ref}
      type={type ?? "button"}
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      {...props}
    >
      {busy ? <LoaderCircle className="animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
});
