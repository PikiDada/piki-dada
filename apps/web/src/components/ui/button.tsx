import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  // Restrained motion: a small press and a shadow shift read as confident, where the
  // previous 8% hover/active scale read as a toy. Focus ring is visible for keyboard
  // users without following every mouse click.
  // Disabled is styled per variant rather than by dimming with opacity: a 45%-opacity
  // black pill reads as a heavy grey slab that dominates the screen it sits on.
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-medium transition-all duration-200 ease-out active:scale-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-50 disabled:pointer-events-none disabled:translate-y-0 disabled:shadow-none",
  {
    variants: {
      variant: {
        default:
          "bg-neutral-900 text-white shadow-card hover:-translate-y-px hover:bg-neutral-800 hover:shadow-lift disabled:bg-neutral-200 disabled:text-neutral-400",
        brand:
          "bg-brand text-neutral-900 shadow-card hover:-translate-y-px hover:brightness-[1.04] hover:shadow-brand disabled:bg-neutral-200 disabled:text-neutral-400",
        outline:
          "border border-neutral-300 bg-white text-neutral-900 shadow-card hover:border-neutral-400 hover:bg-neutral-50 hover:shadow-lift disabled:border-neutral-200 disabled:bg-neutral-50 disabled:text-neutral-400",
        ghost:
          "text-neutral-700 hover:bg-neutral-100 hover:text-neutral-900 disabled:text-neutral-400",
        destructive:
          "bg-red-600 text-white shadow-card hover:-translate-y-px hover:bg-red-700 hover:shadow-lift disabled:bg-neutral-200 disabled:text-neutral-400",
      },
      size: {
        default: "h-11 px-6",
        sm: "h-9 px-4 text-sm",
        lg: "h-14 px-8 text-base",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
